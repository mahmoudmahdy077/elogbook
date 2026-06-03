import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import type { CaseTemplate, TemplateField } from '@elogbook/shared';

export default function LogCaseScreen() {
  const [templates, setTemplates] = useState<CaseTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<CaseTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [patientMrn, setPatientMrn] = useState('');
  const [patientDob, setPatientDob] = useState('');
  const [caseDate, setCaseDate] = useState('');
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: profile } = await supabase
      .from('profiles')
      .select('tenant_id')
      .eq('user_id', user.id)
      .single();

    if (!profile) return;

    const { data } = await supabase
      .from('case_templates')
      .select('*')
      .eq('tenant_id', profile.tenant_id);

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
    if (!selectedTemplate) return;
    setSubmitting(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: profile } = await supabase
      .from('profiles')
      .select('id, tenant_id')
      .eq('user_id', user.id)
      .single();

    if (!profile) return;

    const { data: tenant } = await supabase
      .from('tenants')
      .select('tenant_type')
      .eq('id', profile.tenant_id)
      .single();

    const status = tenant?.tenant_type === 'individual' ? 'pending' : 'draft';

    await supabase.from('case_entries').insert({
      tenant_id: profile.tenant_id,
      resident_id: profile.id,
      template_id: selectedTemplate.id,
      patient_mrn: patientMrn,
      patient_dob: patientDob,
      case_date: caseDate,
      field_values: fieldValues,
      status,
    });

    setSubmitting(false);
    setSelectedTemplate(null);
    setPatientMrn('');
    setPatientDob('');
    setCaseDate('');
    setFieldValues({});
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
                    ? 'bg-blue-600 border-blue-600'
                    : 'bg-gray-800 border-gray-700'
                }`}
                onPress={() => setFieldValue(field.key, opt)}
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
            className="bg-gray-900 text-white rounded-xl px-4 py-3 border border-gray-700 min-h-[100px]"
            multiline
            textAlignVertical="top"
            placeholder={field.label}
            placeholderTextColor="#666"
            value={value}
            onChangeText={(t) => setFieldValue(field.key, t)}
          />
        </View>
      );
    }

    return (
      <View key={field.key} className="mb-4">
        <Text className="text-gray-400 mb-2">{field.label}</Text>
        <TextInput
          className="bg-gray-900 text-white rounded-xl px-4 py-3 border border-gray-700"
          placeholder={field.label}
          placeholderTextColor="#666"
          keyboardType={field.type === 'number' ? 'numeric' : 'default'}
          value={value}
          onChangeText={(t) => setFieldValue(field.key, t)}
        />
      </View>
    );
  };

  if (loading) {
    return (
      <View className="flex-1 bg-black items-center justify-center">
        <ActivityIndicator color="#3b82f6" size="large" />
      </View>
    );
  }

  if (!selectedTemplate) {
    return (
      <ScrollView className="flex-1 bg-black px-4 pt-4">
        <Text className="text-white text-2xl font-bold mb-6">Select Template</Text>
        {templates.length === 0 ? (
          <Text className="text-gray-400">No templates available.</Text>
        ) : (
          <View className="gap-3">
            {templates.map((t) => (
              <TouchableOpacity
                key={t.id}
                className="bg-gray-900 rounded-xl p-4 border border-gray-800"
                onPress={() => selectTemplate(t)}
              >
                <Text className="text-white font-semibold">{t.specialty} - {t.name}</Text>
                <Text className="text-gray-500 text-sm mt-1">
                  {t.fields.length} field{t.fields.length !== 1 ? 's' : ''}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-black"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView className="flex-1 px-4 pt-4">
        <View className="flex-row items-center mb-6">
          <TouchableOpacity onPress={() => setSelectedTemplate(null)}>
            <Text className="text-blue-400 mr-3">Back</Text>
          </TouchableOpacity>
          <Text className="text-white text-2xl font-bold">
            {selectedTemplate.specialty} - {selectedTemplate.name}
          </Text>
        </View>

        <View className="bg-gray-900 rounded-xl p-4 border border-gray-800 mb-6">
          <Text className="text-gray-400 mb-2">MRN</Text>
          <TextInput
            className="bg-black text-white rounded-xl px-4 py-3 border border-gray-700"
            placeholder="Patient MRN"
            placeholderTextColor="#666"
            value={patientMrn}
            onChangeText={setPatientMrn}
          />

          <Text className="text-gray-400 mb-2 mt-4">Date of Birth</Text>
          <TextInput
            className="bg-black text-white rounded-xl px-4 py-3 border border-gray-700"
            placeholder="YYYY-MM-DD"
            placeholderTextColor="#666"
            value={patientDob}
            onChangeText={setPatientDob}
          />

          <Text className="text-gray-400 mb-2 mt-4">Case Date</Text>
          <TextInput
            className="bg-black text-white rounded-xl px-4 py-3 border border-gray-700"
            placeholder="YYYY-MM-DD"
            placeholderTextColor="#666"
            value={caseDate}
            onChangeText={setCaseDate}
          />
        </View>

        <View className="bg-gray-900 rounded-xl p-4 border border-gray-800 mb-6">
          {selectedTemplate.fields.map(renderField)}
        </View>

        <TouchableOpacity
          className="bg-blue-600 rounded-xl py-4 items-center mb-10"
          onPress={handleSubmit}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-white font-semibold text-base">Submit Case</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
