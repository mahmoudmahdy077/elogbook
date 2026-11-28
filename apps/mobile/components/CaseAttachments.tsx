/**
 * Case attachments on mobile — parity with the web case detail.
 *
 * Uses the same `case-attachments` storage bucket and `case_attachments`
 * table as the web: path = `{tenantSlug}/{caseId}/{id}-{safeName}`, row
 * owner = uploading profile. Storage and table RLS decide access; this
 * component only hides actions the caller cannot take.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Linking,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { randomUUID } from 'expo-crypto';
import { Ionicons } from '@expo/vector-icons';
import { clinicalTokens, isMobileFeatureEnabled, type UserRole } from '@elogbook/shared';
import { useRemoteConfig } from '../lib/remote-config-context';
import { supabase } from '../lib/supabase';
import { validateAttachment } from '../lib/attachments';
import { logWarn } from '../lib/logger';

interface Attachment {
  id: string;
  entry_id: string;
  file_path: string;
  file_type: string;
  file_name: string | null;
  file_size: number | null;
  uploaded_by: string | null;
  uploaded_at: string | null;
}

interface Props {
  caseId: string;
  tenantId: string;
  profileId: string;
  role: UserRole | null;
}

function safeName(name: string): string {
  return name.replace(/[^\w.-]+/g, '_').slice(0, 120) || 'attachment';
}

function formatSize(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function CaseAttachments({ caseId, tenantId, profileId, role }: Props) {
  const { config } = useRemoteConfig();
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);

  const canManage = (a: Attachment) =>
    a.uploaded_by === profileId ||
    ['supervisor', 'director', 'institution_admin', 'admin'].includes(role ?? '');

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('case_attachments')
      .select('id, entry_id, file_path, file_type, file_name, file_size, uploaded_by, uploaded_at')
      .eq('entry_id', caseId)
      .order('uploaded_at', { ascending: false });

    if (!error) setAttachments((data ?? []) as Attachment[]);
    setLoading(false);
  }, [caseId]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('tenants')
        .select('slug')
        .eq('id', tenantId)
        .maybeSingle();
      if (data?.slug) setTenantSlug(data.slug as string);
    })();
    void load();
  }, [tenantId, load]);

  const pickAndUpload = async () => {
    if (!tenantSlug) {
      Alert.alert('Not ready', 'Could not resolve your tenant. Pull to refresh and retry.');
      return;
    }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Allow photo access to attach a picture to this case.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsMultipleSelection: false,
    });
    if (result.canceled || !result.assets?.length) return;

    const asset = result.assets[0];
    const name = safeName(asset.fileName ?? `photo-${Date.now()}.jpg`);
    const mime = asset.mimeType ?? 'image/jpeg';
    const size = asset.fileSize ?? 0;

    const check = validateAttachment({ mime, sizeBytes: size, name });
    if (!check.ok) {
      Alert.alert('File not allowed', check.reason ?? 'Choose a JPEG, PNG, HEIC or PDF under 10 MB.');
      return;
    }
    if (size === 0) {
      Alert.alert('File not allowed', 'The selected file has no readable size.');
      return;
    }

    setUploading(true);
    try {
      const response = await fetch(asset.uri);
      const body = await response.arrayBuffer();
      const id = randomUUID();
      const path = `${tenantSlug}/${caseId}/${id}-${name}`;

      const { error: uploadError } = await supabase.storage
        .from('case-attachments')
        .upload(path, body, { contentType: mime, upsert: false });
      if (uploadError) {
        Alert.alert('Upload failed', uploadError.message);
        return;
      }

      const { error: insertError } = await supabase.from('case_attachments').insert({
        id,
        entry_id: caseId,
        tenant_id: tenantId,
        file_path: path,
        file_type: mime,
        file_name: name,
        file_size: size,
        uploaded_by: profileId,
      });
      if (insertError) {
        // Roll back the orphaned object so storage does not accumulate it.
        await supabase.storage.from('case-attachments').remove([path]);
        Alert.alert('Upload failed', insertError.message);
        return;
      }

      await load();
    } catch {
      logWarn('attachments.upload-failed');
      Alert.alert('Upload failed', 'Could not read or send the selected file.');
    } finally {
      setUploading(false);
    }
  };

  const open = async (a: Attachment) => {
    setBusyId(a.id);
    try {
      const { data, error } = await supabase.storage
        .from('case-attachments')
        .createSignedUrl(a.file_path, 60);
      if (error || !data?.signedUrl) {
        Alert.alert('Could not open', error?.message ?? 'No link was returned.');
        return;
      }
      await Linking.openURL(data.signedUrl);
    } finally {
      setBusyId(null);
    }
  };

  const remove = (a: Attachment) => {
    Alert.alert('Delete attachment?', a.file_name ?? 'This file', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setBusyId(a.id);
          await supabase.storage.from('case-attachments').remove([a.file_path]);
          const { error } = await supabase.from('case_attachments').delete().eq('id', a.id);
          setBusyId(null);
          if (error) {
            Alert.alert('Delete failed', error.message);
            return;
          }
          setAttachments((prev) => prev.filter((x) => x.id !== a.id));
        },
      },
    ]);
  };

  if (!isMobileFeatureEnabled(config, 'attachments')) return null;

  return (
    <View
      style={{
        backgroundColor: '#FFFFFF',
        borderRadius: 14,
        borderWidth: 1,
        borderColor: 'rgba(0,122,255,0.15)',
        padding: 14,
        marginBottom: 14,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text
          style={{
            fontFamily: clinicalTokens.fonts.heading,
            fontWeight: '600',
            fontSize: 15,
            color: clinicalTokens.colors.text.primary,
          }}
        >
          Attachments
        </Text>
        <TouchableOpacity
          onPress={pickAndUpload}
          disabled={uploading}
          accessibilityLabel="Add an attachment"
          accessibilityRole="button"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 16,
            backgroundColor: clinicalTokens.colors.primary.DEFAULT,
            opacity: uploading ? 0.6 : 1,
          }}
        >
          {uploading ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Ionicons name="add" size={16} color="#FFFFFF" />
          )}
          <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '600' }}>
            {uploading ? 'Uploading…' : 'Add file'}
          </Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 12 }} color={clinicalTokens.colors.primary.DEFAULT} />
      ) : attachments.length === 0 ? (
        <Text
          style={{
            marginTop: 10,
            fontFamily: clinicalTokens.fonts.body,
            fontSize: 13,
            color: clinicalTokens.colors.text.muted,
          }}
        >
          No attachments yet.
        </Text>
      ) : (
        attachments.map((a) => (
          <View
            key={a.id}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              paddingVertical: 9,
              borderTopWidth: 1,
              borderTopColor: 'rgba(0,0,0,0.06)',
              marginTop: 8,
            }}
          >
            <Ionicons
              name={a.file_type === 'application/pdf' ? 'document-text-outline' : 'image-outline'}
              size={20}
              color={clinicalTokens.colors.primary.DEFAULT}
            />
            <View style={{ flex: 1 }}>
              <Text
                numberOfLines={1}
                style={{
                  fontFamily: clinicalTokens.fonts.body,
                  fontSize: 14,
                  color: clinicalTokens.colors.text.primary,
                }}
              >
                {a.file_name ?? 'Attachment'}
              </Text>
              <Text
                style={{
                  fontFamily: clinicalTokens.fonts.mono,
                  fontSize: 11,
                  color: clinicalTokens.colors.text.muted,
                  marginTop: 1,
                }}
              >
                {formatSize(a.file_size)}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => void open(a)}
              disabled={busyId === a.id}
              accessibilityLabel="Open attachment"
              accessibilityRole="button"
              style={{ padding: 8 }}
            >
              <Ionicons name="open-outline" size={18} color={clinicalTokens.colors.primary.DEFAULT} />
            </TouchableOpacity>
            {canManage(a) && (
              <TouchableOpacity
                onPress={() => remove(a)}
                disabled={busyId === a.id}
                accessibilityLabel="Delete attachment"
                accessibilityRole="button"
                style={{ padding: 8 }}
              >
                <Ionicons name="trash-outline" size={18} color={clinicalTokens.colors.status.text.danger} />
              </TouchableOpacity>
            )}
          </View>
        ))
      )}
    </View>
  );
}

export default CaseAttachments;
