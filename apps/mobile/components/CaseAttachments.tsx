/**
 * Case attachments on mobile — parity with the web case detail.
 *
 * Reads and writes go through `lib/attachments-store` (the approved adapter
 * for `case_attachments`), which owns the storage path and validation rules.
 * Storage and table RLS decide access; this component only hides actions the
 * caller cannot take.
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
import { Ionicons } from '@expo/vector-icons';
import { clinicalTokens, isMobileFeatureEnabled, type UserRole } from '@elogbook/shared';
import { supabase } from '../lib/supabase';
import { useRemoteConfig } from '../lib/remote-config-context';
import {
  caseAttachmentUrl,
  deleteCaseAttachment,
  listCaseAttachments,
  uploadCaseAttachment,
  type CaseAttachment,
} from '../lib/attachments-store';

interface Props {
  caseId: string;
  tenantId: string;
  profileId: string;
  role: UserRole | null;
}

function formatSize(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function CaseAttachments({ caseId, tenantId, profileId, role }: Props) {
  const { config } = useRemoteConfig();
  const [attachments, setAttachments] = useState<CaseAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);

  const canManage = (a: CaseAttachment) =>
    a.uploaded_by === profileId ||
    ['supervisor', 'director', 'institution_admin', 'admin'].includes(role ?? '');

  const load = useCallback(async () => {
    const { data } = await listCaseAttachments(caseId);
    setAttachments(data);
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

  const uploadAsset = async (asset: ImagePicker.ImagePickerAsset) => {
    if (!tenantSlug) {
      Alert.alert('Not ready', 'Could not resolve your tenant. Pull to refresh and retry.');
      return;
    }
    const name = asset.fileName ?? `photo-${Date.now()}.jpg`;
    const mime = asset.mimeType ?? 'image/jpeg';

    setUploading(true);
    try {
      const uploaded = await uploadCaseAttachment({
        caseId,
        tenantId,
        tenantSlug,
        profileId,
        file: {
          uri: asset.uri,
          name,
          mime,
          sizeBytes: asset.fileSize ?? 1,
        },
      });
      if (!uploaded.ok) {
        Alert.alert('Upload failed', uploaded.error);
        return;
      }
      setAttachments((prev) => [uploaded.attachment, ...prev]);
    } finally {
      setUploading(false);
    }
  };

  const pickFromLibrary = async () => {
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
    if (!result.canceled && result.assets?.length) await uploadAsset(result.assets[0]);
  };

  const takePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Allow camera access to photograph a document for this case.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    if (!result.canceled && result.assets?.length) await uploadAsset(result.assets[0]);
  };

  const open = async (a: CaseAttachment) => {
    setBusyId(a.id);
    try {
      const { url, error } = await caseAttachmentUrl(a);
      if (!url) {
        Alert.alert('Could not open', error ?? 'No link was returned.');
        return;
      }
      await Linking.openURL(url);
    } finally {
      setBusyId(null);
    }
  };

  const remove = (a: CaseAttachment) => {
    Alert.alert('Delete attachment?', a.file_name ?? 'This file', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setBusyId(a.id);
          const res = await deleteCaseAttachment(a);
          setBusyId(null);
          if (!res.ok) {
            Alert.alert('Delete failed', res.error ?? 'Unknown error');
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
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity
            onPress={takePhoto}
            disabled={uploading}
            accessibilityLabel="Take a photo for this case"
            accessibilityRole="button"
            style={{
              padding: 8,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: clinicalTokens.colors.primary.DEFAULT,
              opacity: uploading ? 0.6 : 1,
            }}
          >
            <Ionicons name="camera-outline" size={18} color={clinicalTokens.colors.primary.DEFAULT} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={pickFromLibrary}
            disabled={uploading}
            accessibilityLabel="Choose a photo for this case"
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
              {uploading ? 'Uploading…' : 'Add photo'}
            </Text>
          </TouchableOpacity>
        </View>
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
