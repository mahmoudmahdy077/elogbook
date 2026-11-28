/**
 * Consent management on mobile — parity with the web consent page.
 * Reads the latest record per type and writes through `set_user_consent`.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Switch,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { clinicalTokens } from '@elogbook/shared';
import { supabase } from '../lib/supabase';
import { getSession } from '../lib/session';
import {
  CONSENT_TYPES,
  listConsent,
  setConsent,
  type ConsentType,
} from '../lib/consent-store';

export default function ConsentScreen() {
  const [tenantId, setTenantId] = useState<string | null>(
    getSession().capability?.tenantId ?? null,
  );
  const [granted, setGranted] = useState<Partial<Record<ConsentType, boolean>>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<ConsentType | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    let tenant = tenantId;
    if (!tenant) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('user_id', user?.id ?? '')
        .maybeSingle();
      tenant = (profile?.tenant_id as string | undefined) ?? null;
      setTenantId(tenant);
    }
    if (!tenant) {
      setError('Could not resolve your tenant.');
      setLoading(false);
      return;
    }
    const result = await listConsent(tenant);
    setGranted(result.granted);
    setError(result.error);
    setLoading(false);
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (type: ConsentType, next: boolean) => {
    if (!tenantId || busy) return;
    setBusy(type);
    setError(null);
    const previous = granted[type] ?? false;
    setGranted((prev) => ({ ...prev, [type]: next }));
    const result = await setConsent(tenantId, type, next);
    if (!result.ok) {
      setGranted((prev) => ({ ...prev, [type]: previous }));
      setError(result.error ?? 'Could not save that preference.');
    }
    setBusy(null);
  };

  return (
    <View style={{ flex: 1, backgroundColor: clinicalTokens.colors.backdrop.dark }}>
      <View
        style={{
          paddingTop: 58,
          paddingHorizontal: 20,
          paddingBottom: 10,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <TouchableOpacity
          onPress={() => router.back()}
          accessibilityLabel="Go back"
          accessibilityRole="button"
          style={{ width: 40, height: 40, justifyContent: 'center' }}
        >
          <Ionicons name="chevron-back" size={26} color={clinicalTokens.colors.primary.DEFAULT} />
        </TouchableOpacity>
        <Text
          style={{
            fontFamily: clinicalTokens.fonts.heading,
            fontWeight: '700',
            fontSize: 26,
            color: clinicalTokens.colors.text.primary,
          }}
        >
          Consent
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}>
        <Text
          style={{
            fontFamily: clinicalTokens.fonts.body,
            fontSize: 14,
            lineHeight: 20,
            color: clinicalTokens.colors.text.muted,
            marginBottom: 16,
          }}
        >
          Withdraw or re-grant consent for each category. Changes apply immediately and are
          recorded in the tenant audit log.
        </Text>

        {loading ? (
          <ActivityIndicator color={clinicalTokens.colors.primary.DEFAULT} />
        ) : (
          CONSENT_TYPES.map((item) => (
            <View
              key={item.key}
              style={{
                backgroundColor: '#FFFFFF',
                borderRadius: 14,
                borderWidth: 1,
                borderColor: 'rgba(0,122,255,0.15)',
                padding: 14,
                marginBottom: 10,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontFamily: clinicalTokens.fonts.heading,
                    fontWeight: '600',
                    fontSize: 15,
                    color: clinicalTokens.colors.text.primary,
                  }}
                >
                  {item.label}
                </Text>
                <Text
                  style={{
                    marginTop: 3,
                    fontFamily: clinicalTokens.fonts.body,
                    fontSize: 13,
                    lineHeight: 18,
                    color: clinicalTokens.colors.text.muted,
                  }}
                >
                  {item.description}
                </Text>
              </View>
              <Switch
                value={granted[item.key] ?? false}
                onValueChange={(next) => void toggle(item.key, next)}
                disabled={busy !== null}
                accessibilityLabel={`${item.label} consent`}
                trackColor={{ true: clinicalTokens.colors.primary.DEFAULT }}
              />
            </View>
          ))
        )}

        {error && (
          <Text
            accessibilityRole="alert"
            style={{
              marginTop: 6,
              fontFamily: clinicalTokens.fonts.body,
              fontSize: 13,
              color: clinicalTokens.colors.status.text.danger,
            }}
          >
            {error}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}
