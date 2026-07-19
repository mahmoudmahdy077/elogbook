import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { supabase } from '../../lib/supabase';
import { clinicalTokens } from '@elogbook/shared';
import ScreenWrapper from '../../components/ScreenWrapper';

const MAX_LEVEL = 5;

interface MilestoneData {
  id: string;
  competency_area: string;
  sub_competency: string;
  level: number;
  assessment_date: string;
  assessor_id: string | null;
  comments: string | null;
}

interface ResidentData {
  id: string;
  full_name: string;
}

interface CompetencyGroup {
  area: string;
  items: {
    sub: string;
    level: number;
    id: string;
  }[];
}

function groupMilestones(milestones: MilestoneData[]): CompetencyGroup[] {
  const map = new Map<string, { sub: string; level: number; id: string }[]>();

  for (const m of milestones) {
    const existing = map.get(m.competency_area) ?? [];
    // Keep the latest assessment for each sub-competency
    const idx = existing.findIndex((e) => e.sub === m.sub_competency);
    if (idx >= 0) {
      if (m.level > existing[idx].level) {
        existing[idx] = { sub: m.sub_competency, level: m.level, id: m.id };
      }
    } else {
      existing.push({ sub: m.sub_competency, level: m.level, id: m.id });
    }
    map.set(m.competency_area, existing);
  }

  return Array.from(map.entries())
    .map(([area, items]) => ({ area, items }))
    .sort((a, b) => a.area.localeCompare(b.area));
}

// ── Milestone Matrix ──────────────────────────────────────────────────

function MilestoneMatrix({
  milestones,
}: {
  milestones: MilestoneData[];
}) {
  const groups = useMemo(() => groupMilestones(milestones), [milestones]);

  if (groups.length === 0) {
    return (
      <Animated.View entering={FadeIn.delay(200).springify()}>
        <View className="bg-white/5 rounded-xl p-6 border border-gray-700/50 items-center">
          <Text
            className="text-[#8E8E93] text-sm"
            style={{ fontFamily: clinicalTokens.fonts.body }}
          >
            No milestones recorded yet.
          </Text>
        </View>
      </Animated.View>
    );
  }

  return (
    <View>
      {groups.map((group, index) => (
        <Animated.View
          key={group.area}
          entering={FadeInDown.delay(index * 80 + 200).springify()}
        >
          <View className="mb-4 bg-white/5 rounded-xl p-3 border border-gray-700/30">
          <Text
            className="text-primary text-sm font-semibold mb-2"
            style={{ fontFamily: clinicalTokens.fonts.heading }}
          >
            {group.area}
          </Text>

          {group.items.map((item) => (
            <View
              key={item.sub}
              className="flex-row items-center py-2 border-b border-gray-800/50"
            >
              <Text
                className="text-[#3C3C43] text-sm flex-1 mr-2"
                style={{ fontFamily: clinicalTokens.fonts.body }}
                numberOfLines={2}
              >
                {item.sub}
              </Text>

              {/* Level dots */}
              <View className="flex-row items-center gap-1">
                {Array.from({ length: MAX_LEVEL }, (_, i) => (
                  <View
                    key={i}
                    className={`w-3 h-3 rounded-full ${
                      i < item.level ? 'bg-teal-500' : 'bg-gray-700'
                    }`}
                  />
                ))}
              </View>
            </View>
          ))}
        </View>
        </Animated.View>
      ))}
    </View>
  );
}

// ── Resident Picker (Director+) ──────────────────────────────────────

function ResidentPicker({
  residents,
  selectedResident,
  onSelect,
  loading,
}: {
  residents: ResidentData[];
  selectedResident: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
}) {
  if (loading) {
    return (
      <View className="py-4 items-center">
        <ActivityIndicator color={clinicalTokens.colors.primary.DEFAULT} size="small" />
      </View>
    );
  }

  if (residents.length === 0) {
    return (
      <View className="bg-white/5 rounded-xl p-4 border border-gray-700/50 mb-4">
        <Text
          className="text-[#8E8E93] text-sm"
          style={{ fontFamily: clinicalTokens.fonts.body }}
        >
          No residents found in this tenant.
        </Text>
      </View>
    );
  }

  return (
    <View className="mb-4">
      <Text
        className="text-[#8E8E93] text-xs mb-2"
        style={{ fontFamily: clinicalTokens.fonts.body }}
      >
        Select Resident
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="gap-2">
        {residents.map((r) => (
          <TouchableOpacity
            key={r.id}
            className={`rounded-xl px-4 py-2 border ${
              selectedResident === r.id
                ? 'bg-primary border-teal-500'
                : 'bg-white/10 border-gray-700'
            }`}
            onPress={() => onSelect(r.id)}
            accessibilityLabel={`Select resident: ${r.full_name}`}
            accessibilityRole="button"
          >
            <Text
              className={`text-sm ${
                selectedResident === r.id ? 'text-white' : 'text-[#3C3C43]'
              }`}
              style={{ fontFamily: clinicalTokens.fonts.body }}
            >
              {r.full_name}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

// ── Main Screen ──────────────────────────────────────────────────────

export default function MilestonesScreen() {
  const [role, setRole] = useState<string | null>(null);
  const [milestones, setMilestones] = useState<MilestoneData[]>([]);
  const [residents, setResidents] = useState<ResidentData[]>([]);
  const [selectedResident, setSelectedResident] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const isDirectorPlus = role === 'director' || role === 'institution_admin' || role === 'admin';

  const fetchMilestones = useCallback(async (residentId: string) => {
    const { data, error } = await supabase
      .from('milestones')
      .select('*')
      .eq('resident_id', residentId)
      .order('competency_area', { ascending: true });

    if (!error) {
      setMilestones((data ?? []) as MilestoneData[]);
    }
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('id, role')
        .eq('user_id', user.id)
        .single();

      if (!profile) {
        setLoading(false);
        return;
      }

      setRole(profile.role);

      const isDirector =
        profile.role === 'director' ||
        profile.role === 'institution_admin' ||
        profile.role === 'admin';

      if (isDirector) {
        // Fetch tenant residents for the picker
        const { data: tenantProfile } = await supabase
          .from('profiles')
          .select('tenant_id')
          .eq('user_id', user.id)
          .single();

        if (tenantProfile) {
          const { data: residentProfiles } = await supabase
            .from('profiles')
            .select('id, full_name')
            .eq('tenant_id', tenantProfile.tenant_id)
            .eq('role', 'resident');

          setResidents((residentProfiles ?? []) as ResidentData[]);

          // Auto-select first resident if none selected
          if (residentProfiles && residentProfiles.length > 0 && !selectedResident) {
            const firstId = residentProfiles[0].id;
            setSelectedResident(firstId);
            await fetchMilestones(firstId);
          }
        }
      } else {
        // Resident or supervisor sees their own milestones
        // (supervisors see milestone data for residents they supervise)
        if (profile.role === 'supervisor') {
          // Supervisors see all resident milestones in their tenant
          const { data: tenantProfile } = await supabase
            .from('profiles')
            .select('tenant_id')
            .eq('user_id', user.id)
            .single();

          if (tenantProfile) {
            const { data: residentProfiles } = await supabase
              .from('profiles')
              .select('id, full_name')
              .eq('tenant_id', tenantProfile.tenant_id)
              .eq('role', 'resident');

            setResidents((residentProfiles ?? []) as ResidentData[]);

            if (residentProfiles && residentProfiles.length > 0 && !selectedResident) {
              const firstId = residentProfiles[0].id;
              setSelectedResident(firstId);
              await fetchMilestones(firstId);
            }
          }
        } else {
          // Resident: their own milestones
          setSelectedResident(profile.id);
          await fetchMilestones(profile.id);
        }
      }
    } catch (err) {
      console.error('Failed to load milestones:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedResident, fetchMilestones]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    if (selectedResident) {
      await fetchMilestones(selectedResident);
    } else {
      await loadData();
    }
    setRefreshing(false);
  }, [selectedResident, fetchMilestones, loadData]);

  const handleResidentSelect = useCallback(
    async (residentId: string) => {
      setSelectedResident(residentId);
      await fetchMilestones(residentId);
    },
    [fetchMilestones],
  );

  if (loading) {
    return (
      <ScreenWrapper title="Milestones" scroll={false}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={clinicalTokens.colors.primary.DEFAULT} size="large" />
        </View>
      </ScreenWrapper>
    );
  }

  return (
    <ScreenWrapper title="Milestones" scroll={false}>
      <ScrollView
        className="flex-1 px-4 pt-4"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={clinicalTokens.colors.primary.DEFAULT}
          />
        }
      >
        <Animated.View entering={FadeIn.delay(100).springify()}>
          <Text
            className="text-[#000000] text-2xl mb-4"
            style={{ fontFamily: clinicalTokens.fonts.heading }}
          >
            Milestones
          </Text>
        </Animated.View>

        {/* Resident picker for director+ and supervisors */}
        {(isDirectorPlus || role === 'supervisor') && (
          <Animated.View entering={FadeInDown.delay(150).springify()}>
            <ResidentPicker
              residents={residents}
              selectedResident={selectedResident}
              onSelect={handleResidentSelect}
              loading={loading}
            />
          </Animated.View>
        )}

        {/* Milestone matrix */}
        {selectedResident && (
          <MilestoneMatrix milestones={milestones} />
        )}

        {!selectedResident && !loading && (
          <Animated.View entering={FadeIn.delay(200).springify()}>
            <View className="bg-white/5 rounded-xl p-6 border border-gray-700/50 items-center">
            <Text
              className="text-[#8E8E93] text-sm"
              style={{ fontFamily: clinicalTokens.fonts.body }}
            >
              Select a resident to view milestones.
            </Text>
          </View>
          </Animated.View>
        )}
      </ScrollView>
    </ScreenWrapper>
  );
}
