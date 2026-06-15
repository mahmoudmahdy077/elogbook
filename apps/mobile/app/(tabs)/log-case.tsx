import { useState, useEffect, useRef } from 'react';
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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { syncService } from '../../lib/sync';
import { saveDraftCase } from '../../lib/db/storage';
import { useHaptics } from '../../lib/haptics';
import { caseEntrySchema } from '@elogbook/shared';
import type { CaseTemplate, TemplateField } from '@elogbook/shared';

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
  const [templates, setTemplates] = useState<CaseTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<CaseTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const isSubmitting = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [confirmationSuccess, setConfirmationSuccess] = useState(true);

  const [isDeidentified, setIsDeidentified] = useState(true);
  const [patientMrn, setPatientMrn] = useState('');
  const [patientDob, setPatientDob] = useState('');
  const [patientAge, setPatientAge] = useState('');
  const [caseDate, setCaseDate] = useState('');
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [syncStatus, setSyncStatus] = useState(syncService.getStatus());

  const haptics = useHaptics();

  useEffect(() => {
    loadTemplates();
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
      .select('tenant_id')
      .eq('user_id', user.id)
      .single();

    if (!profile) { setLoading(false); return; }

    const { data, error } = await supabase
      .from('case_templates')
      .select('*')
      .eq('tenant_id', profile.tenant_id);

    if (error) { setFetchError(true); setLoading(false); return; }
    if (data) setTemplates(data as CaseTemplate[]);
    setLoading(false);
  };

  const selectTemplate = (t: CaseTemplate) => {
    setSelectedTemplate(t);
    const defaults: Record<string, string> = {};
    for (const field of t.fields) {
      defaults[field.key] = '';
    }
    setFieldValues(defaults);
  };

  const setFieldValue = (key: string, value: string) => {
    setFieldValues((prev) => ({ ...prev, [key]: value }));
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

    const validation = caseEntrySchema.safeParse(entryData);
    if (!validation.success) {
      const firstError = validation.error.issues[0];
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

    try {
      const { error } = await supabase.from('case_entries').insert(caseData);
      if (error) throw error;
      haptics.submitSuccess();
      setConfirmationSuccess(true);
      setShowConfirmation(true);
    } catch {
      await saveDraftCase(caseData);
      haptics.offlineSave();
      setConfirmationSuccess(false);
      setShowConfirmation(true);
    }

    setTimeout(() => {
      setShowConfirmation(false);
      setSubmitting(false);
      isSubmitting.current = false;
      if (confirmationSuccess) {
        setPatientMrn('');
        setPatientDob('');
        setPatientAge('');
        setCaseDate('');
        setFieldValues({});
      }
    }, 2000);
  };

  const renderField = (field: TemplateField) => {
    const value = fieldValues[field.key] ?? '';

    if (field.type === 'select' && field.options) {
      return (
        <View key={field.key} className="mb-4">
          <Text className="text-gray-400 mb-2">{field.label}</Text>
          <View className="flex-row flex-wrap gap-2">
            {field.options.map((opt) => (
              <TouchableOpacity
                key={opt}
                className={`rounded-lg px-3 py-2 border ${
                  value === opt
                    ? 'bg-teal-600 border-teal-500'
                    : 'bg-slate-800 border-slate-700'
                }`}
                onPress={() => { setFieldValue(field.key, opt); haptics.selection(); }}
                accessibilityLabel={opt}
                accessibilityRole="button"
              >
                <Text className="text-white text-sm">{opt}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      );
    }

    if (field.type === 'textarea') {
      return (
        <View key={field.key} className="mb-4">
          <Text className="text-gray-400 mb-2">{field.label}</Text>
          <TextInput
            className="bg-slate-900 text-white rounded-xl px-4 py-3 border border-indigo-500/15 min-h-[100px]"
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
        <Text className="text-gray-400 mb-2">{field.label}</Text>
        <TextInput
          className="bg-slate-900 text-white rounded-xl px-4 py-3 border border-indigo-500/15"
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
      synced: { bg: 'bg-emerald-900/50', border: 'border-emerald-500/30', text: 'Synced', icon: 'checkmark-circle-outline' as const, color: 'text-emerald-400' },
    };
    const c = config[syncStatus as keyof typeof config] ?? config.syncing;
    return (
      <View className={`rounded-lg px-4 py-2 mb-4 flex-row items-center gap-2 ${c.bg} border ${c.border}`}>
        <Ionicons name={c.icon} size={16} color={c.color.replace('text-', '#') || '#fff'} />
        <Text className={`${c.color} text-sm`}>{c.text}</Text>
      </View>
    );
  };

  const renderConfirmation = () => (
    <Modal transparent animationType="fade" visible={showConfirmation}>
      <View className="flex-1 items-center justify-center bg-black/60">
        <View className="bg-slate-900 rounded-2xl p-8 items-center border border-indigo-500/15 mx-8" style={{ backgroundColor: '#0F172A' }}>
          <Ionicons
            name={confirmationSuccess ? 'checkmark-circle' : 'cloud-done-outline'}
            size={64}
            color={confirmationSuccess ? '#0D9488' : '#D97706'}
          />
          <Text className="text-white text-xl font-bold mt-4 text-center">
            {confirmationSuccess ? 'Case Logged Successfully' : 'Saved Offline'}
          </Text>
          <Text className={confirmationSuccess ? 'text-amber-400 mt-2 text-center' : 'text-gray-400 mt-2 text-center'}>
            {confirmationSuccess ? 'Pending Verification' : 'Will sync when online'}
          </Text>
        </View>
      </View>
    </Modal>
  );

  const renderTemplateCard = ({ item: t }: { item: CaseTemplate }) => (
    <TouchableOpacity
      className="bg-slate-900 border border-indigo-500/15 rounded-xl p-4 active:scale-95 m-1 flex-1"
      style={{ maxWidth: '48%' }}
      onPress={() => selectTemplate(t)}
      accessibilityLabel={`${t.specialty} - ${t.name} template`}
      accessibilityRole="button"
    >
      <Ionicons name={getSpecialtyIcon(t.specialty)} size={28} color="#0D9488" />
      <Text className="text-white font-semibold mt-3" numberOfLines={2}>
        {t.specialty} - {t.name}
      </Text>
      <Text className="text-indigo-400 text-xs mt-2 bg-indigo-500/10 self-start px-2 py-0.5 rounded-full">
        {t.fields.length} field{t.fields.length !== 1 ? 's' : ''}
      </Text>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View className="flex-1 px-4 pt-4" style={{ backgroundColor: '#060814' }}>
        <Text className="text-white text-2xl font-bold mb-6">Select Template</Text>
        <View className="flex-row flex-wrap gap-2">
          {[1, 2, 3, 4].map((i) => (
            <View key={i} className="bg-slate-900 rounded-xl p-4 border border-indigo-500/15 flex-1 mb-2" style={{ maxWidth: '48%', height: 100 }}>
              <View className="bg-slate-800 rounded-full w-8 h-8" />
              <View className="bg-slate-800 rounded h-3 mt-3 w-3/4" />
              <View className="bg-slate-800 rounded h-3 mt-2 w-1/2" />
            </View>
          ))}
        </View>
      </View>
    );
  }

  if (!selectedTemplate) {
    return (
      <View className="flex-1" style={{ backgroundColor: '#060814' }}>
        {renderSyncBanner()}
        <FlatList
          data={templates}
          keyExtractor={(t) => t.id}
          renderItem={renderTemplateCard}
          numColumns={2}
          contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 12, paddingBottom: 20 }}
          ListHeaderComponent={
            <Text className="text-white text-2xl font-bold mb-4 px-1">Select Template</Text>
          }
          ListEmptyComponent={
            <View className="items-center py-16">
              <Ionicons name="clipboard-outline" size={48} color="#64748B" />
              <Text className="text-gray-400 text-center mt-4">
                {fetchError ? 'Unable to load templates' : 'No templates available. Contact your program director.'}
              </Text>
              {fetchError && (
                <TouchableOpacity className="mt-4 bg-indigo-600 px-6 py-2 rounded-lg" onPress={loadTemplates} accessibilityLabel="Retry loading templates" accessibilityRole="button">
                  <Text className="text-white">Retry</Text>
                </TouchableOpacity>
              )}
            </View>
          }
        />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      className="flex-1"
      style={{ backgroundColor: '#060814' }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView className="flex-1 px-4 pt-4" contentContainerStyle={{ paddingBottom: 100 }}>
        {renderSyncBanner()}
        <View className="flex-row items-center mb-4">
          <TouchableOpacity onPress={() => setSelectedTemplate(null)} className="mr-3" accessibilityLabel="Go back to template selection" accessibilityRole="button">
            <Ionicons name="arrow-back" size={24} color="#6366F1" />
          </TouchableOpacity>
          <Text className="text-white text-xl font-bold flex-1">
            {selectedTemplate.specialty} - {selectedTemplate.name}
          </Text>
          <TouchableOpacity onPress={() => setSelectedTemplate(null)} accessibilityLabel="Change template" accessibilityRole="button">
            <Text className="text-indigo-400 text-sm">Change Template</Text>
          </TouchableOpacity>
        </View>

        <View className="flex-row items-center justify-between mb-4 px-1">
          <Text className="text-gray-300 text-sm">De-identified entry</Text>
          <Switch
            value={isDeidentified}
            onValueChange={setIsDeidentified}
            trackColor={{ false: '#334155', true: '#0D9488' }}
            thumbColor={isDeidentified ? '#fff' : '#94A3B8'}
            accessibilityLabel="Toggle de-identification"
          />
        </View>

        <View className="bg-slate-900 rounded-xl p-4 border border-indigo-500/15 mb-6">
          {isDeidentified ? (
            <>
              <Text className="text-gray-400 mb-2">Patient Age (years)</Text>
              <TextInput
                className="bg-[#060814] text-white rounded-xl px-4 py-3 border border-indigo-500/15"
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
              <Text className="text-gray-400 mb-2">MRN</Text>
              <TextInput
                className="bg-[#060814] text-white rounded-xl px-4 py-3 border border-indigo-500/15"
                placeholder="Patient MRN"
                placeholderTextColor="#666"
                returnKeyType="next"
                blurOnSubmit={false}
                value={patientMrn}
                onChangeText={setPatientMrn}
                accessibilityLabel="Patient MRN"
              />

              <Text className="text-gray-400 mb-2 mt-4">Date of Birth</Text>
              <TextInput
                className="bg-[#060814] text-white rounded-xl px-4 py-3 border border-indigo-500/15"
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#666"
                returnKeyType="next"
                blurOnSubmit={false}
                value={patientDob}
                onChangeText={setPatientDob}
                accessibilityLabel="Patient date of birth"
              />
            </>
          )}

          <Text className="text-gray-400 mb-2 mt-4">Case Date</Text>
          <TextInput
            className="bg-[#060814] text-white rounded-xl px-4 py-3 border border-indigo-500/15"
            placeholder="YYYY-MM-DD"
            placeholderTextColor="#666"
            returnKeyType="next"
            blurOnSubmit={false}
            value={caseDate}
            onChangeText={setCaseDate}
            accessibilityLabel="Case date"
          />
        </View>

        <View className="bg-slate-900 rounded-xl p-4 border border-indigo-500/15 mb-6">
          {selectedTemplate.fields.map(renderField)}
        </View>
      </ScrollView>

      <View className="absolute bottom-0 left-0 right-0 p-4 border-t border-indigo-500/15" style={{ backgroundColor: 'rgba(6,8,20,0.9)', paddingBottom: Math.max(16, Platform.OS === 'ios' ? 34 : 16) }}>
        <TouchableOpacity
          className={`bg-teal-600 rounded-xl py-4 items-center ${submitting ? 'opacity-50' : ''}`}
          onPress={handleSubmit}
          disabled={submitting}
          accessibilityLabel="Submit case for verification"
          accessibilityRole="button"
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-white font-semibold text-base">Submit for Verification</Text>
          )}
        </TouchableOpacity>
      </View>

      {renderConfirmation()}
    </KeyboardAvoidingView>
  );
}