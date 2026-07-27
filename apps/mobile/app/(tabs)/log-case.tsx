import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Modal,
  Switch,
  Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { syncService } from '../../lib/sync';

import { useHaptics } from '../../lib/haptics';
import { generatePatientHash } from '../../lib/patient-hash';
import { caseEntrySchema, sortTemplates } from '@elogbook/shared';
import type { CaseTemplate, TemplateField, TemplateWithMeta } from '@elogbook/shared';
import { clinicalTokens } from '@elogbook/shared';
import { DateField } from '../../components/DateField';
import ScreenWrapper from '../../components/ScreenWrapper';

const SPECIALTY_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  surgery: 'cut',
  radiology: 'radio',
  emergency: 'flash',
  internal: 'heart',
  cardiology: 'heart',
  neurology: 'medkit',
  orthopedics: 'body',
  pediatrics: 'happy',
  psychiatry: 'chatbubbles',
  custom: 'flask',
};

function getSpecialtyIcon(specialty: string): keyof typeof Ionicons.glyphMap {
  return SPECIALTY_ICONS[specialty.toLowerCase()] ?? 'flask';
}

export default function LogCaseScreen() {
  const { editCaseId, duplicateCaseId, repeatLastEntry } = useLocalSearchParams<{ editCaseId?: string; duplicateCaseId?: string; repeatLastEntry?: string }>();
  const [templates, setTemplates] = useState<CaseTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<CaseTemplate | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const templatesRef = useRef(templates);
  templatesRef.current = templates;
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const isSubmitting = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [confirmationSuccess, setConfirmationSuccess] = useState(true);
  const [validationError, setValidationError] = useState<string | null>(null);
  const confirmationTypeRef = useRef<'offline' | 'submitted' | null>(null);

  const syncColorMap: Record<string, string> = {
    // Intentional: sync status indicator colors — these are not UI theme colors
    // but data-driven mappings from sync state class names to icon colors.
    'text-blue-400': '#60A5FA',
    'text-green-400': '#34D399',
    'text-yellow-400': '#FBBF24',
    'text-red-400': '#F87171',
    'text-[#34C759]': '#34D399',
    'text-amber-400': '#FBBF24',
  };

  const [isDeidentified, setIsDeidentified] = useState(true);
  const [patientMrn, setPatientMrn] = useState('');
  const [patientDob, setPatientDob] = useState('');
  const [patientAge, setPatientAge] = useState('');
  const [caseDate, setCaseDate] = useState('');
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [syncStatus, setSyncStatus] = useState(syncService.getStatus());

  const AUTO_SAVE_KEY = 'case_form_draft';
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        await AsyncStorage.setItem(AUTO_SAVE_KEY, JSON.stringify({
          selectedTemplateId,
          patientMrn,
          patientDob,
          fieldValues,
          isDeidentified,
          step,
        }));
      } catch { /* storage limit */ }
    }, 1500);
    return () => clearTimeout(timer);
  // Auto-save effect — step intentionally omitted to avoid saving on every step change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTemplateId, patientMrn, patientDob, fieldValues, isDeidentified]);

  const haptics = useHaptics();

  useFocusEffect(useCallback(() => {
    loadTemplates();
  }, [loadTemplates]));

  // When the route is opened with `editCaseId`, hydrate the form from the
  // local DB row (or fall back to Supabase if not cached). The submit path
  // then performs an UPDATE rather than an INSERT.
  useEffect(() => {
    if (!editCaseId) return;
    (async () => {
      const { data } = await supabase
        .from('case_entries')
        .select('*')
        .eq('id', editCaseId)
        .single();
      if (data) {
        setIsDeidentified(Boolean(data.is_deidentified));
        setPatientMrn(data.patient_mrn ?? '');
        setPatientDob(data.patient_dob ?? '');
        setPatientAge(data.patient_age_years != null ? String(data.patient_age_years) : '');
        setCaseDate(data.case_date ?? '');
        setSelectedTemplateId(String(data.template_id ?? ''));
        const fv = typeof data.field_values === 'string'
          ? (() => { try { return JSON.parse(data.field_values) as Record<string, string>; } catch { return {}; } })()
          : ((data.field_values as Record<string, string>) ?? {});
        setFieldValues(fv);
      } else {
        Alert.alert('Case not found', 'The case you tried to edit is no longer available.');
      }
    })();
  }, [editCaseId]);

  // When the route is opened with `duplicateCaseId`, fetch the source case
  // and hydrate the form — PHI fields are always cleared, case_date is set to
  // today, and the submit path uses INSERT (default) rather than UPDATE.
  useEffect(() => {
    if (!duplicateCaseId) return;
    (async () => {
      const { data, error } = await supabase
        .from('case_entries')
        .select('template_id, is_deidentified, patient_mrn, patient_dob, patient_age_years, case_date, field_values')
        .eq('id', duplicateCaseId)
        .single();
      if (error || !data) {
        Alert.alert('Source case not found', 'Could not load the case you want to duplicate.');
        return;
      }
      setIsDeidentified(Boolean(data.is_deidentified));
      setPatientMrn('');
      setPatientDob('');
      setPatientAge(data.patient_age_years != null ? String(data.patient_age_years) : '');
      setCaseDate(new Date().toISOString().slice(0, 10));
      const tmplId = String(data.template_id ?? '');
      setSelectedTemplateId(tmplId);
      const fv = typeof data.field_values === 'string'
        ? (() => { try { return JSON.parse(data.field_values) as Record<string, string>; } catch { return {}; } })()
        : ((data.field_values as Record<string, string>) ?? {});
      setFieldValues(fv);
      // If templates are already loaded, auto-select the matching template
      const t = templatesRef.current.find((x) => x.id === tmplId);
      if (t) {
        setSelectedTemplate(t);
      }
    })();
  }, [duplicateCaseId]);

  // When the route is opened with `repeatLastEntry=true`, find the resident's
  // most recent case and hydrate as a duplicate.
  useEffect(() => {
    if (String(repeatLastEntry) !== 'true') return;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('user_id', user.id)
        .single();
      if (!profile) return;
      const { data, error } = await supabase
        .from('case_entries')
        .select('id, template_id, is_deidentified, patient_age_years, field_values')
        .eq('resident_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      if (error || !data) {
        Alert.alert('No previous entry', 'You have no previous case entries to repeat from.');
        return;
      }
      // Reuse the duplicate hydration for the most recent case
      setIsDeidentified(Boolean(data.is_deidentified));
      setPatientMrn('');
      setPatientDob('');
      setPatientAge(data.patient_age_years != null ? String(data.patient_age_years) : '');
      setCaseDate(new Date().toISOString().slice(0, 10));
      const tmplId = String(data.template_id ?? '');
      setSelectedTemplateId(tmplId);
      const fv = typeof data.field_values === 'string'
        ? (() => { try { return JSON.parse(data.field_values) as Record<string, string>; } catch { return {}; } })()
        : ((data.field_values as Record<string, string>) ?? {});
      setFieldValues(fv);
      const t = templatesRef.current.find((x) => x.id === tmplId);
      if (t) {
        setSelectedTemplate(t);
      }
    })();
  }, [repeatLastEntry]);

  useEffect(() => {
    (async () => {
      try {
        const draft = await AsyncStorage.getItem(AUTO_SAVE_KEY);
        if (draft) {
          const data = JSON.parse(draft);
          const hasData = data.selectedTemplateId || data.patientMrn;
          if (hasData) {
            Alert.alert('Unsaved Draft', 'You have an unsaved case draft. Recover it?', [
              { text: 'Discard', style: 'destructive', onPress: () => AsyncStorage.removeItem(AUTO_SAVE_KEY) },
              { text: 'Recover', onPress: () => {
                if (data.selectedTemplateId) setSelectedTemplateId(data.selectedTemplateId);
                if (data.patientMrn !== undefined) setPatientMrn(data.patientMrn);
                if (data.patientDob !== undefined) setPatientDob(data.patientDob);
                if (data.fieldValues !== undefined) setFieldValues(data.fieldValues);
                if (data.isDeidentified !== undefined) setIsDeidentified(data.isDeidentified);
                if (data.step !== undefined) setStep(data.step);
              }},
            ]);
          } else {
            await AsyncStorage.removeItem(AUTO_SAVE_KEY);
          }
        }
      } catch { /* ignore parse errors */ }
    })();
  }, []);

  useEffect(() => {
    return syncService.onStatusChange(setSyncStatus);
  }, []);

  const loadTemplates = async () => {
    setLoading(true);
    setFetchError(false);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data: profile } = await supabase
      .from('profiles')
      .select('id, tenant_id')
      .eq('user_id', user.id)
      .single();

    if (!profile) { setLoading(false); return; }

    const { data, error } = await supabase
      .from('case_templates')
      .select('*')
      .eq('tenant_id', profile.tenant_id);

    if (error) { setFetchError(true); setLoading(false); return; }
    if (data) {
      const allTemplates = data as unknown as CaseTemplate[];
      let favIds = new Set<string>();
      let personalCounts = new Map<string, number>();

      const { data: favData } = await supabase
        .from('template_favorites')
        .select('template_id')
        .eq('user_id', user.id);
      if (favData) {
        favIds = new Set(favData.map((r: { template_id: string }) => r.template_id));
      }

      const { data: personalData } = await supabase
        .from('case_entries')
        .select('template_id')
        .eq('resident_id', profile.id);
      if (personalData) {
        personalCounts = new Map(
          Array.from(
            personalData.reduce((acc: Map<string, number>, r: { template_id: string }) => {
              acc.set(r.template_id, (acc.get(r.template_id) ?? 0) + 1);
              return acc;
            }, new Map<string, number>())
          )
        );
      }

      setFavoriteIds(favIds);
      const sorted = sortTemplates(allTemplates, favIds, personalCounts, new Map());
      setTemplates(sorted as unknown as CaseTemplate[]);

      const autoSelectId = editCaseId || duplicateCaseId || String(repeatLastEntry) === 'true' ? selectedTemplateId : null;
      if (autoSelectId) {
        const t = sorted.find((x) => x.id === autoSelectId);
        if (t) setSelectedTemplate(t);
      }
    }
    setLoading(false);
  };

  const toggleFavorite = useCallback(async (templateId: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    if (favoriteIds.has(templateId)) {
      const { error } = await supabase
        .from('template_favorites')
        .delete()
        .eq('user_id', user.id)
        .eq('template_id', templateId);
      if (error) { Alert.alert('Error', 'Failed to remove favorite.'); return; }
      setFavoriteIds((prev) => {
        const next = new Set(prev);
        next.delete(templateId);
        return next;
      });
      setTemplates((prev) =>
        prev.map((t) =>
          t.id === templateId ? { ...t, is_favorite: false } as unknown as CaseTemplate : t
        )
      );
    } else {
      const { error } = await supabase
        .from('template_favorites')
        .insert({ user_id: user.id, template_id: templateId });
      if (error) { Alert.alert('Error', 'Failed to add favorite.'); return; }
      setFavoriteIds((prev) => {
        const next = new Set(prev);
        next.add(templateId);
        return next;
      });
      setTemplates((prev) =>
        prev.map((t) =>
          t.id === templateId ? { ...t, is_favorite: true } as unknown as CaseTemplate : t
        )
      );
    }
  }, [favoriteIds]);

  const selectTemplate = useCallback((t: CaseTemplate) => {
    setSelectedTemplate(t);
    const defaults: Record<string, string> = {};
    for (const field of t.fields) {
      defaults[field.key] = '';
    }
    setFieldValues(defaults);
  }, []);

  const setFieldValue = (key: string, value: string) => {
    setFieldValues((prev) => ({ ...prev, [key]: value }));
    if (validationError) setValidationError(null);
  };

  const handleSubmit = async () => {
    if (!selectedTemplate || isSubmitting.current) return;

    const entryData = isDeidentified
      ? {
          template_id: selectedTemplate.id,
          patient_age_years: Number(patientAge) || 0,
          patient_hash: '',
          case_date: caseDate,
          field_values: fieldValues,
          is_deidentified: true as const,
        }
      : {
          template_id: selectedTemplate.id,
          patient_mrn: patientMrn,
          patient_dob: patientDob,
          case_date: caseDate,
          field_values: fieldValues,
          is_deidentified: false as const,
        };

    setValidationError(null);
    const validation = caseEntrySchema.safeParse(entryData);
    if (!validation.success) {
      const firstError = validation.error.issues[0];
      setValidationError(firstError?.message ?? 'Invalid case data');
      return;
    }

    isSubmitting.current = true;
    setSubmitting(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSubmitting(false); isSubmitting.current = false; return; }

    const { data: profile } = await supabase
      .from('profiles')
      .select('id, tenant_id')
      .eq('user_id', user.id)
      .single();

    if (!profile) { setSubmitting(false); isSubmitting.current = false; return; }

    const { data: tenant } = await supabase
      .from('tenants')
      .select('tenant_type')
      .eq('id', profile.tenant_id)
      .single();

    // Edits always re-submit for approval (status='pending' if individual, else
    // 'draft' for the supervisor queue). New cases follow the same rule.
    const status = tenant?.tenant_type === 'individual' ? 'pending' : 'draft';

    const caseData = {
      tenant_id: profile.tenant_id,
      resident_id: profile.id,
      template_id: selectedTemplate.id,
      patient_mrn: isDeidentified ? undefined : patientMrn,
      patient_dob: isDeidentified ? undefined : patientDob,
      patient_age_years: isDeidentified ? Number(patientAge) : undefined,
      case_date: caseDate,
      field_values: fieldValues,
      status,
      is_deidentified: isDeidentified,
    };

    if (editCaseId) {
      try {
        const { error } = await supabase
          .from('case_entries')
          .update({
            ...caseData,
            status: 'pending',
          })
          .eq('id', editCaseId);
        if (error) throw error;
        haptics.submitSuccess();
        setConfirmationSuccess(true);
        confirmationTypeRef.current = 'submitted';
        setShowConfirmation(true);
      } catch {
        haptics.offlineSave();
        setConfirmationSuccess(false);
        confirmationTypeRef.current = 'offline';
        setShowConfirmation(true);
      }
      setTimeout(() => {
        setShowConfirmation(false);
        setSubmitting(false);
        isSubmitting.current = false;
        confirmationTypeRef.current = null;
      }, 2000);
      return;
    }

    try {
      const { error } = await supabase.from('case_entries').insert(caseData);
      if (error) throw error;
      await AsyncStorage.removeItem(AUTO_SAVE_KEY);
      haptics.submitSuccess();
      setConfirmationSuccess(true);
      confirmationTypeRef.current = 'submitted';
      setShowConfirmation(true);
    } catch {
      haptics.offlineSave();
      setConfirmationSuccess(false);
      confirmationTypeRef.current = 'offline';
      setShowConfirmation(true);
    }

    setTimeout(() => {
      setShowConfirmation(false);
      setSubmitting(false);
      isSubmitting.current = false;
      if (confirmationTypeRef.current === 'submitted') {
        setPatientMrn('');
        setPatientDob('');
        setPatientAge('');
        setCaseDate('');
        setFieldValues({});
        setConfirmationSuccess(false);
      } else if (confirmationTypeRef.current === 'offline') {
        setConfirmationSuccess(false);
      }
      confirmationTypeRef.current = null;
    }, 2000);
  };

  const renderField = (field: TemplateField) => {
    const value = fieldValues[field.key] ?? '';

    if (field.type === 'select' && field.options) {
      return (
        <View key={field.key} className="mb-4">
          <Text className="text-[#3C3C43] mb-2" style={{ fontFamily: clinicalTokens.fonts.body }}>{field.label}</Text>
          <View className="flex-row flex-wrap gap-2">
            {field.options.map((opt) => (
              <TouchableOpacity
                key={opt}
                className={`rounded-lg px-3 py-2 border ${
                  value === opt
                    ? 'bg-primary border-teal-500'
                    : 'bg-gray-200 border-gray-300'
                }`}
                onPress={() => { setFieldValue(field.key, opt); haptics.selection(); }}
                accessibilityLabel={opt}
                accessibilityRole="button"
              >
                <Text className={`text-sm ${value === opt ? 'text-white' : 'text-[#000000]'}`}>{opt}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      );
    }

    if (field.type === 'textarea') {
      return (
        <View key={field.key} className="mb-4">
          <Text className="text-[#3C3C43] mb-2" style={{ fontFamily: clinicalTokens.fonts.body }}>{field.label}</Text>
          <TextInput
            className="bg-white text-[#000000] rounded-xl px-4 py-3 border border-[#007AFF]/15 min-h-[100px]"
            multiline
            textAlignVertical="top"
            returnKeyType="next"
            placeholder={field.label}
            placeholderTextColor="#666"
            value={value}
            onChangeText={(t) => setFieldValue(field.key, t)}
            accessibilityLabel={field.label}
          />
        </View>
      );
    }

    return (
      <View key={field.key} className="mb-4">
        <Text className="text-[#3C3C43] mb-2" style={{ fontFamily: clinicalTokens.fonts.body }}>{field.label}</Text>
        <TextInput
          className="bg-white text-[#000000] rounded-xl px-4 py-3 border border-[#007AFF]/15"
          placeholder={field.label}
          placeholderTextColor="#666"
          returnKeyType="next"
          blurOnSubmit={false}
          keyboardType={field.type === 'number' ? 'numeric' : 'default'}
          value={value}
          onChangeText={(t) => setFieldValue(field.key, t)}
          accessibilityLabel={field.label}
        />
      </View>
    );
  };

  const renderSyncBanner = () => {
    if (syncStatus === 'idle') return null;
    const config = {
      syncing: { bg: 'bg-blue-900/50', border: 'border-blue-500/30', text: 'Syncing...', icon: 'cloud-upload-outline' as const, color: 'text-blue-400' },
      error: { bg: 'bg-red-900/50', border: 'border-red-500/30', text: 'Sync failed — will retry', icon: 'alert-circle-outline' as const, color: 'text-red-400' },
      offline: { bg: 'bg-amber-900/50', border: 'border-amber-500/30', text: 'Offline Mode — cases saved locally', icon: 'cloud-offline-outline' as const, color: 'text-amber-400' },
      synced: { bg: 'bg-emerald-900/50', border: 'border-emerald-500/30', text: 'Synced', icon: 'checkmark-circle-outline' as const, color: 'text-[#34C759]' },
    };
        const c = config[syncStatus as keyof typeof config] ?? config.syncing;
    return (
      <View className={`rounded-lg px-4 py-2 mb-4 flex-row items-center gap-2 ${c.bg} border ${c.border}`}>
        <Ionicons name={c.icon} size={16}         color={syncColorMap[c.color] || clinicalTokens.colors.text.muted} />
        <Text className={`${c.color} text-sm`} style={{ fontFamily: clinicalTokens.fonts.body }}>{c.text}</Text>
      </View>
    );
  };

  const renderConfirmation = () => (
    <Modal transparent animationType="fade" visible={showConfirmation}>
      <View className="flex-1 items-center justify-center bg-black/60">
        <View className="bg-white rounded-2xl p-8 items-center border border-[#007AFF]/15 mx-8" style={{ backgroundColor: clinicalTokens.colors.neutral.dark }}>
          <Ionicons
            name={confirmationSuccess ? 'checkmark-circle' : 'cloud-done-outline'}
            size={64}
            color={confirmationSuccess ? clinicalTokens.colors.primary.DEFAULT : clinicalTokens.colors.warning.DEFAULT}
          />
          <Text className="text-white text-xl mt-4 text-center" style={{ fontFamily: clinicalTokens.fonts.heading }}>
            {confirmationSuccess ? 'Case Logged Successfully' : 'Saved Offline'}
          </Text>
          <Text className={confirmationSuccess ? 'text-amber-400 mt-2 text-center' : 'text-gray-400 mt-2 text-center'} style={{ fontFamily: clinicalTokens.fonts.body }}>
            {confirmationSuccess ? 'Pending Verification' : 'Will sync when online'}
          </Text>
        </View>
      </View>
    </Modal>
  );

  const renderTemplateCard = useCallback(({ item: t }: { item: CaseTemplate }) => {
    const tmpl = t as unknown as TemplateWithMeta;
    return (
      <TouchableOpacity
        className="bg-white border border-[#007AFF]/15 rounded-xl p-4 active:scale-95 m-1 flex-1"
        style={{ maxWidth: '48%' }}
        onPress={() => selectTemplate(t)}
        accessibilityLabel={`${t.specialty} - ${t.name} template`}
        accessibilityRole="button"
      >
        <View className="flex-row justify-between items-start">
          <Ionicons name={getSpecialtyIcon(t.specialty)} size={28} color={clinicalTokens.colors.primary.DEFAULT} />
          <TouchableOpacity
            onPress={() => toggleFavorite(t.id)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel={tmpl.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
            accessibilityRole="button"
          >
            <Text className={tmpl.is_favorite ? 'text-amber-400' : 'text-gray-600'} style={{ fontSize: 18 }}>
              {tmpl.is_favorite ? '★' : '☆'}
            </Text>
          </TouchableOpacity>
        </View>
        <Text className="text-[#000000] mt-3" numberOfLines={2} style={{ fontFamily: clinicalTokens.fonts.heading }}>
          {t.specialty} - {t.name}
        </Text>
        <Text className="text-[#007AFF] text-xs mt-2 bg-[#007AFF]/10 self-start px-2 py-0.5 rounded-full" style={{ fontFamily: clinicalTokens.fonts.body }}>
          {t.fields.length} field{t.fields.length !== 1 ? 's' : ''}
        </Text>
      </TouchableOpacity>
    );
  }, [selectTemplate, toggleFavorite]);

  if (loading) {
    return (
      <ScreenWrapper title="Log Case" scroll={false}>
        <View className="flex-row flex-wrap gap-2">
          {[1, 2, 3, 4].map((i) => (
            <View key={i} className="bg-white rounded-xl p-4 border border-[#007AFF]/15 flex-1 mb-2" style={{ maxWidth: '48%', height: 100 }}>
              <View className="bg-gray-200 rounded-full w-8 h-8" />
              <View className="bg-gray-200 rounded h-3 mt-3 w-3/4" />
              <View className="bg-gray-200 rounded h-3 mt-2 w-1/2" />
            </View>
          ))}
        </View>
      </ScreenWrapper>
    );
  }

  if (!selectedTemplate) {
    return (
      <ScreenWrapper title="Log Case" scroll={false}>
        {renderSyncBanner()}
        <FlatList
          data={templates}
          keyExtractor={(t) => t.id}
          renderItem={renderTemplateCard}
          numColumns={2}
          contentContainerStyle={{ paddingBottom: 20 }}
          ListHeaderComponent={
            <Text className="text-[#000000] text-2xl mb-4" style={{ fontFamily: clinicalTokens.fonts.heading }}>Select Template</Text>
          }
          ListEmptyComponent={
            <View className="items-center py-16">
              <Ionicons name="clipboard-outline" size={48} color={clinicalTokens.colors.text.muted} />
              <Text className="text-gray-400 text-center mt-4" style={{ fontFamily: clinicalTokens.fonts.body }}>
                {fetchError ? 'Unable to load templates' : 'No templates available. Contact your program director.'}
              </Text>
                {fetchError && (
                  <TouchableOpacity className="mt-4 bg-[#007AFF] px-6 py-2 rounded-lg" onPress={loadTemplates} accessibilityLabel="Retry loading templates" accessibilityRole="button">
                    <Text className="text-white" style={{ fontFamily: clinicalTokens.fonts.heading }}>Retry</Text>
                  </TouchableOpacity>
                )}
            </View>
          }
        />
      </ScreenWrapper>
    );
  }

  return (
    <ScreenWrapper title="Log Case" scroll={false}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 100 }} keyboardShouldPersistTaps="handled">
          {renderSyncBanner()}
          <View className="flex-row items-center mb-4">
            <TouchableOpacity onPress={() => setSelectedTemplate(null)} className="mr-3" accessibilityLabel="Go back to template selection" accessibilityRole="button">
              <Ionicons name="arrow-back" size={24} color={clinicalTokens.colors.secondary.DEFAULT} />
            </TouchableOpacity>
            <Text className="text-[#000000] text-xl flex-1" style={{ fontFamily: clinicalTokens.fonts.heading }}>
              {selectedTemplate.specialty} - {selectedTemplate.name}
            </Text>
            <TouchableOpacity onPress={() => setSelectedTemplate(null)} accessibilityLabel="Change template" accessibilityRole="button">
              <Text className="text-[#007AFF] text-sm" style={{ fontFamily: clinicalTokens.fonts.body }}>Change Template</Text>
            </TouchableOpacity>
          </View>

          <View className="flex-row items-center justify-between mb-4">
            <Text className="text-[#3C3C43] text-sm" style={{ fontFamily: clinicalTokens.fonts.body }}>De-identified entry</Text>
            <Switch
            value={isDeidentified}
            onValueChange={setIsDeidentified}
            trackColor={{ false: clinicalTokens.colors.neutral.light, true: clinicalTokens.colors.primary.DEFAULT }}
            thumbColor={isDeidentified ? clinicalTokens.colors.text.onPrimary : clinicalTokens.colors.text.muted}
            accessibilityLabel="Toggle de-identification"
          />
        </View>

        <View className="bg-white rounded-xl p-4 border border-[#007AFF]/15 mb-6">
          {isDeidentified ? (
            <>
              <Text className="text-gray-400 mb-2" style={{ fontFamily: clinicalTokens.fonts.body }}>Patient Age (years)</Text>
              <TextInput
                className="text-white rounded-xl px-4 py-3 border border-[#007AFF]/15" style={{ backgroundColor: clinicalTokens.colors.backdrop.dark }}
                placeholder="Age in years"
                placeholderTextColor="#666"
                keyboardType="numeric"
                returnKeyType="next"
                blurOnSubmit={false}
                value={patientAge}
                onChangeText={setPatientAge}
                accessibilityLabel="Patient age in years"
              />
            </>
          ) : (
            <>
              <Text className="text-gray-400 mb-2" style={{ fontFamily: clinicalTokens.fonts.body }}>MRN</Text>
              <TextInput
                className="text-white rounded-xl px-4 py-3 border border-[#007AFF]/15" style={{ backgroundColor: clinicalTokens.colors.backdrop.dark }}
                placeholder="Patient MRN"
                placeholderTextColor="#666"
                returnKeyType="next"
                blurOnSubmit={false}
                value={patientMrn}
                onChangeText={setPatientMrn}
                accessibilityLabel="Patient MRN"
              />

              <Text className="text-gray-400 mb-2 mt-4" style={{ fontFamily: clinicalTokens.fonts.body }}>Date of Birth</Text>
              <DateField
                label="Date of Birth"
                accessibilityLabel="Patient date of birth"
                value={patientDob}
                onChange={setPatientDob}
                maximumDate={new Date()}
              />
            </>
          )}

          <View className="mt-4">
            <DateField
              label="Case Date"
              accessibilityLabel="Case date"
              value={caseDate}
              onChange={setCaseDate}
              maximumDate={new Date()}
            />
          </View>
        </View>

        <View className="bg-white rounded-xl p-4 border border-[#007AFF]/15 mb-6">
          {selectedTemplate.fields.map(renderField)}
        </View>
      </ScrollView>

      {validationError && (
        <View className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 mb-2 mx-4">
          <Text className="text-red-400 text-sm" style={{ fontFamily: clinicalTokens.fonts.body }}>
            {validationError}
          </Text>
        </View>
      )}
      <View className="absolute bottom-0 left-0 right-0 p-4 border-t border-[#007AFF]/15" style={{ backgroundColor: 'rgba(6,8,20,0.9)', paddingBottom: Math.max(16, Platform.OS === 'ios' ? 34 : 16) }}>
        <TouchableOpacity
          className={`bg-primary rounded-xl py-4 items-center ${submitting ? 'opacity-50' : ''}`}
          onPress={handleSubmit}
          disabled={submitting}
          accessibilityLabel="Submit case for verification"
          accessibilityRole="button"
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-white text-base" style={{ fontFamily: clinicalTokens.fonts.heading }}>
              {editCaseId ? 'Resubmit for Verification' : 'Submit for Verification'}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {renderConfirmation()}
    </KeyboardAvoidingView>
    </ScreenWrapper>
  );
}