import { useState, useEffect } from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { supabase } from '../../lib/supabase';

interface CaseWithTemplate {
  id: string;
  patient_mrn: string;
  patient_dob: string;
  case_date: string;
  status: string;
  template_name: string;
  template_specialty: string;
}

export default function MyCasesScreen() {
  const [cases, setCases] = useState<CaseWithTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCases();
  }, []);

  const loadCases = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (!profile) return;

    const { data } = await supabase
      .from('case_entries')
      .select('id, patient_mrn, patient_dob, case_date, status, case_templates(name, specialty)')
      .eq('resident_id', profile.id)
      .order('created_at', { ascending: false });

    if (data) {
      const mapped: CaseWithTemplate[] = data.map((entry: any) => ({
        id: entry.id,
        patient_mrn: entry.patient_mrn,
        patient_dob: entry.patient_dob,
        case_date: entry.case_date,
        status: entry.status,
        template_name: entry.case_templates?.name ?? '',
        template_specialty: entry.case_templates?.specialty ?? '',
      }));
      setCases(mapped);
    }
    setLoading(false);
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'approved':
        return 'text-green-400';
      case 'pending':
        return 'text-yellow-400';
      case 'draft':
        return 'text-gray-400';
      case 'rejected':
        return 'text-red-400';
      default:
        return 'text-gray-400';
    }
  };

  if (loading) {
    return (
      <View className="flex-1 bg-black items-center justify-center">
        <ActivityIndicator color="#3b82f6" size="large" />
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-black px-4 pt-4">
      <Text className="text-white text-2xl font-bold mb-6">My Cases</Text>

      {cases.length === 0 ? (
        <View className="bg-gray-900 rounded-xl p-6 border border-gray-800 items-center">
          <Text className="text-gray-400">No cases logged yet.</Text>
        </View>
      ) : (
        <View className="gap-3 mb-6">
          {cases.map((c) => (
            <View
              key={c.id}
              className="bg-gray-900 rounded-xl p-4 border border-gray-800"
            >
              <View className="flex-row justify-between items-start">
                <View className="flex-1">
                  <Text className="text-white font-semibold">
                    {c.template_specialty} - {c.template_name}
                  </Text>
                  <Text className="text-gray-500 text-sm mt-1">
                    MRN: {c.patient_mrn}
                  </Text>
                  <Text className="text-gray-500 text-sm">
                    Date: {c.case_date}
                  </Text>
                </View>
                <Text className={`font-semibold uppercase text-xs ${statusColor(c.status)}`}>
                  {c.status}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}
