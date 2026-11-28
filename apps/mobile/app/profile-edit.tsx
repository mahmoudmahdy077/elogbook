/**
 * Edit own profile — mobile parity with the web onboarding/profile fields.
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { clinicalTokens } from '@elogbook/shared';
import { fetchOwnProfile, updateOwnProfile } from '../lib/profile-store';

const SPECIALTIES = [
  'Surgery',
  'Internal Medicine',
  'Pediatrics',
  'Emergency',
  'Radiology',
  'Cardiology',
  'Neurology',
  'Orthopedics',
  'Psychiatry',
];

export default function ProfileEditScreen() {
  const [fullName, setFullName] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    (async () => {
      const { profile, error: readError } = await fetchOwnProfile();
      if (profile) {
        setFullName(profile.full_name ?? '');
        setSpecialty(profile.specialty ?? '');
      }
      setError(readError);
      setLoading(false);
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    setSuccess(false);
    const result = await updateOwnProfile({
      fullName,
      specialty,
      completeOnboarding: true,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? 'Could not save your profile.');
      return;
    }
    setSuccess(true);
    setTimeout(() => router.back(), 700);
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
          Edit profile
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}>
        {loading ? (
          <ActivityIndicator color={clinicalTokens.colors.primary.DEFAULT} />
        ) : (
          <>
            <Text
              style={{
                fontFamily: clinicalTokens.fonts.body,
                fontSize: 12,
                textTransform: 'uppercase',
                letterSpacing: 1,
                color: clinicalTokens.colors.text.muted,
                marginBottom: 6,
              }}
            >
              Full name
            </Text>
            <TextInput
              value={fullName}
              onChangeText={(v) => setFullName(v.slice(0, 120))}
              placeholder="Dr. Jane Smith"
              accessibilityLabel="Full name"
              style={{
                backgroundColor: '#FFFFFF',
                borderRadius: 12,
                borderWidth: 1,
                borderColor: 'rgba(0,122,255,0.2)',
                paddingHorizontal: 14,
                paddingVertical: 12,
                fontSize: 16,
                color: clinicalTokens.colors.text.primary,
                fontFamily: clinicalTokens.fonts.body,
                marginBottom: 18,
              }}
            />

            <Text
              style={{
                fontFamily: clinicalTokens.fonts.body,
                fontSize: 12,
                textTransform: 'uppercase',
                letterSpacing: 1,
                color: clinicalTokens.colors.text.muted,
                marginBottom: 8,
              }}
            >
              Specialty
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
              {SPECIALTIES.map((item) => {
                const selected = specialty === item;
                return (
                  <TouchableOpacity
                    key={item}
                    onPress={() => setSpecialty(selected ? '' : item)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`Specialty ${item}`}
                    style={{
                      paddingHorizontal: 14,
                      paddingVertical: 9,
                      borderRadius: 18,
                      borderWidth: 1,
                      borderColor: selected
                        ? clinicalTokens.colors.primary.DEFAULT
                        : 'rgba(0,0,0,0.15)',
                      backgroundColor: selected ? 'rgba(0,122,255,0.10)' : '#FFFFFF',
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: clinicalTokens.fonts.body,
                        fontSize: 14,
                        color: clinicalTokens.colors.text.primary,
                      }}
                    >
                      {item}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TouchableOpacity
              onPress={save}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel="Save profile"
              style={{
                minHeight: 50,
                borderRadius: 25,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: clinicalTokens.colors.primary.DEFAULT,
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '600' }}>Save</Text>
              )}
            </TouchableOpacity>

            {success && (
              <Text
                style={{
                  marginTop: 12,
                  textAlign: 'center',
                  fontFamily: clinicalTokens.fonts.body,
                  fontSize: 13,
                  color: clinicalTokens.colors.status.text.success,
                }}
              >
                Profile saved.
              </Text>
            )}
            {error && (
              <Text
                accessibilityRole="alert"
                style={{
                  marginTop: 12,
                  textAlign: 'center',
                  fontFamily: clinicalTokens.fonts.body,
                  fontSize: 13,
                  color: clinicalTokens.colors.status.text.danger,
                }}
              >
                {error}
              </Text>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}
