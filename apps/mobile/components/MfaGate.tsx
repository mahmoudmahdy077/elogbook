/**
 * AAL2 gate for privileged mobile roles (director / institution_admin /
 * admin). Mirrors the web shell: the app is unusable until the session is
 * verified with the user's authenticator-app factor.
 *
 * If no verified factor exists, the user is sent to the web enrollment page;
 * sign-out is always available so a misconfigured session cannot trap them.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { clinicalTokens } from '@elogbook/shared';
import { supabase } from '../lib/supabase';
import { mobileApiBase } from '../lib/mobile-api';

type Phase = 'checking' | 'needs-code' | 'needs-factor' | 'error';

export function MfaGate({ onVerified }: { onVerified: () => void }) {
  const [phase, setPhase] = useState<Phase>('checking');
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const check = useCallback(async () => {
    setError(null);
    setPhase('checking');
    try {
      const { data, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aalError) {
        setError(aalError.message);
        setPhase('error');
        return;
      }
      if (data?.currentLevel === 'aal2') {
        onVerified();
        return;
      }

      const { data: factors, error: factorError } = await supabase.auth.mfa.listFactors();
      if (factorError) {
        setError(factorError.message);
        setPhase('error');
        return;
      }
      const totp = factors?.totp?.find((f) => f.status === 'verified');
      if (!totp) {
        setPhase('needs-factor');
        return;
      }
      setFactorId(totp.id);
      setPhase('needs-code');
    } catch {
      setError('Could not check your two-factor status.');
      setPhase('error');
    }
  }, [onVerified]);

  useEffect(() => {
    void check();
  }, [check]);

  const verify = async () => {
    if (!factorId || !/^\d{6}$/.test(code.trim()) || verifying) return;
    setVerifying(true);
    setError(null);
    try {
      const challenge = await supabase.auth.mfa.challenge({ factorId });
      if (challenge.error || !challenge.data) {
        setError(challenge.error?.message ?? 'Could not start verification.');
        return;
      }
      const result = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.data.id,
        code: code.trim(),
      });
      if (result.error) {
        setError('That code did not work. Check the authenticator and try again.');
        setCode('');
        return;
      }
      onVerified();
    } catch {
      setError('Verification failed. Try again.');
    } finally {
      setVerifying(false);
    }
  };

  const openEnrollment = () => {
    void Linking.openURL(`${mobileApiBase()}/mfa/enroll`);
  };

  return (
    <View
      style={{
        flex: 1,
        justifyContent: 'center',
        paddingHorizontal: 28,
        backgroundColor: clinicalTokens.colors.backdrop.dark,
      }}
    >
      <View style={{ alignItems: 'center', marginBottom: 22 }}>
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: 20,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: clinicalTokens.colors.primary.glow,
            marginBottom: 16,
          }}
        >
          <Ionicons name="shield-checkmark-outline" size={32} color={clinicalTokens.colors.primary.DEFAULT} />
        </View>
        <Text
          style={{
            fontFamily: clinicalTokens.fonts.heading,
            fontSize: 21,
            fontWeight: '600',
            color: clinicalTokens.colors.text.primary,
            textAlign: 'center',
          }}
        >
          Two-factor verification
        </Text>
        <Text
          style={{
            marginTop: 8,
            fontFamily: clinicalTokens.fonts.body,
            fontSize: 14,
            lineHeight: 20,
            color: clinicalTokens.colors.text.muted,
            textAlign: 'center',
          }}
        >
          Your role needs an authenticator code before the app opens.
        </Text>
      </View>

      {phase === 'checking' && <ActivityIndicator color={clinicalTokens.colors.primary.DEFAULT} />}

      {phase === 'needs-code' && (
        <>
          <TextInput
            value={code}
            onChangeText={(v) => setCode(v.replace(/[^0-9]/g, '').slice(0, 6))}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            placeholder="000000"
            maxLength={6}
            accessibilityLabel="Authenticator code"
            style={{
              alignSelf: 'center',
              width: 200,
              textAlign: 'center',
              letterSpacing: 8,
              fontSize: 26,
              paddingVertical: 12,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: 'rgba(0,122,255,0.35)',
              backgroundColor: '#FFFFFF',
              color: clinicalTokens.colors.text.primary,
              fontFamily: clinicalTokens.fonts.mono,
            }}
          />
          <TouchableOpacity
            onPress={verify}
            disabled={verifying || code.length !== 6}
            accessibilityRole="button"
            style={{
              marginTop: 18,
              alignSelf: 'center',
              minHeight: 48,
              paddingHorizontal: 32,
              borderRadius: 24,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: clinicalTokens.colors.primary.DEFAULT,
              opacity: verifying || code.length !== 6 ? 0.55 : 1,
            }}
          >
            {verifying ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '600' }}>Verify</Text>
            )}
          </TouchableOpacity>
        </>
      )}

      {phase === 'needs-factor' && (
        <>
          <Text
            style={{
              fontFamily: clinicalTokens.fonts.body,
              fontSize: 14,
              lineHeight: 21,
              color: clinicalTokens.colors.text.primary,
              textAlign: 'center',
            }}
          >
            No authenticator is enrolled yet. Enroll on the web, then return here.
          </Text>
          <TouchableOpacity
            onPress={openEnrollment}
            accessibilityRole="button"
            style={{
              marginTop: 18,
              alignSelf: 'center',
              minHeight: 48,
              paddingHorizontal: 28,
              borderRadius: 24,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: clinicalTokens.colors.primary.DEFAULT,
            }}
          >
            <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '600' }}>Open enrollment</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => void check()}
            accessibilityRole="button"
            style={{ marginTop: 10, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ color: clinicalTokens.colors.primary.DEFAULT, fontSize: 14 }}>
              I enrolled — check again
            </Text>
          </TouchableOpacity>
        </>
      )}

      {error && (
        <Text
          accessibilityRole="alert"
          style={{
            marginTop: 14,
            textAlign: 'center',
            fontFamily: clinicalTokens.fonts.body,
            fontSize: 13,
            color: clinicalTokens.colors.status.text.danger,
          }}
        >
          {error}
        </Text>
      )}

      {phase === 'error' && (
        <TouchableOpacity
          onPress={() => void check()}
          accessibilityRole="button"
          style={{ marginTop: 14, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ color: clinicalTokens.colors.primary.DEFAULT, fontSize: 14 }}>Try again</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        onPress={() => {
          supabase.auth.signOut().catch(() => undefined);
        }}
        accessibilityRole="button"
        style={{ marginTop: 18, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
      >
        <Text style={{ color: clinicalTokens.colors.text.muted, fontSize: 14 }}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

export default MfaGate;
