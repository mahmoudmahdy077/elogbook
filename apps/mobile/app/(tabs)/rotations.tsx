import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  RefreshControl,
  Modal,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { clinicalTokens } from '@elogbook/shared';
import ScreenWrapper from '../../components/ScreenWrapper';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const ROTATION_COLORS = [
  '#3B82F6', // blue
  '#10B981', // green
  '#F59E0B', // amber
  '#EF4444', // red
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#F97316', // orange
];

interface RotationData {
  id: string;
  title: string;
  specialty: string | null;
  start_date: string;
  end_date: string;
  site: string | null;
  status: string;
  notes: string | null;
  resident_id: string;
}

function getRotationColor(index: number): string {
  return ROTATION_COLORS[index % ROTATION_COLORS.length];
}

function isDateInRange(date: Date, startStr: string, endStr: string): boolean {
  const start = new Date(startStr);
  const end = new Date(endStr);
  // Normalise to start-of-day for inclusive comparison
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const e = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  return d >= s && d <= e;
}

// ── Month Calendar Component ──────────────────────────────────────────

interface MonthCalendarProps {
  year: number;
  month: number; // 0-indexed
  rotations: RotationData[];
  onRotationTap: (r: RotationData) => void;
}

function MonthCalendar({ year, month, rotations, onRotationTap }: MonthCalendarProps) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startWeekday = firstDay.getDay(); // 0=Sun

  const cells: (number | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  // Pad to full rows
  while (cells.length % 7 !== 0) cells.push(null);

  // Group rotations that overlap this month
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0, 23, 59, 59);
  const visibleRotations = rotations.filter((r) => {
    const rStart = new Date(r.start_date);
    const rEnd = new Date(r.end_date);
    return rStart <= monthEnd && rEnd >= monthStart;
  });

  return (
    <View>
      {/* Weekday headers */}
      <View className="flex-row mb-2">
        {WEEKDAYS.map((wd) => (
          <View key={wd} className="flex-1 items-center py-1">
            <Text
              className="text-gray-500 text-xs"
              style={{ fontFamily: clinicalTokens.fonts.body }}
            >
              {wd}
            </Text>
          </View>
        ))}
      </View>

      {/* Day grid */}
      {(() => {
        const rows: React.ReactNode[] = [];
        for (let row = 0; row < cells.length / 7; row++) {
          const rowCells = cells.slice(row * 7, row * 7 + 7);
          rows.push(
            <View key={row} className="flex-row mb-1">
              {rowCells.map((day, ci) => {
                if (day === null) {
                  return <View key={`e-${row}-${ci}`} className="flex-1 aspect-square" />;
                }
                const dateObj = new Date(year, month, day);
                const rotationsToday = visibleRotations.filter((r) =>
                  isDateInRange(dateObj, r.start_date, r.end_date),
                );

                return (
                  <View
                    key={`d-${day}`}
                    className="flex-1 aspect-square p-0.5"
                  >
                    <Text
                      className="text-white text-xs text-right pr-1"
                      style={{ fontFamily: clinicalTokens.fonts.mono }}
                    >
                      {day}
                    </Text>
                    {rotationsToday.length > 0 && (
                      <View className="flex-row flex-wrap gap-0.5 mt-0.5">
                        {rotationsToday.slice(0, 3).map((r) => (
                          <TouchableOpacity
                            key={r.id}
                            onPress={() => onRotationTap(r)}
                            accessibilityLabel={`Rotation: ${r.title}`}
                            accessibilityRole="button"
                          >
                            <View
                              className="rounded-sm h-1.5 w-full"
                              style={{
                                backgroundColor: getRotationColor(
                                  visibleRotations.indexOf(r),
                                ),
                                minWidth: 10,
                              }}
                            />
                          </TouchableOpacity>
                        ))}
                        {rotationsToday.length > 3 && (
                          <Text
                            className="text-gray-500 text-xs"
                            style={{ fontFamily: clinicalTokens.fonts.body }}
                          >
                            +{rotationsToday.length - 3}
                          </Text>
                        )}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>,
          );
        }
        return rows;
      })()}

      {/* Rotation legend */}
      {visibleRotations.length > 0 && (
        <View className="mt-4 border-t border-gray-700 pt-3">
          <Text
            className="text-gray-400 text-sm mb-2"
            style={{ fontFamily: clinicalTokens.fonts.body }}
          >
            Active Rotations
          </Text>
          {visibleRotations.slice(0, 6).map((r, i) => (
            <TouchableOpacity
              key={r.id}
              className="flex-row items-center py-1.5"
              onPress={() => onRotationTap(r)}
              accessibilityLabel={`View rotation: ${r.title}`}
              accessibilityRole="button"
            >
              <View
                className="w-3 h-3 rounded-full mr-2"
                style={{ backgroundColor: getRotationColor(i) }}
              />
              <Text
                className="text-white text-sm flex-1"
                style={{ fontFamily: clinicalTokens.fonts.body }}
              >
                {r.title}
              </Text>
              <Text
                className="text-gray-500 text-xs"
                style={{ fontFamily: clinicalTokens.fonts.mono }}
              >
                {new Date(r.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                {' — '}
                {new Date(r.end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

// ── Rotation Detail Modal ─────────────────────────────────────────────

function RotationDetailModal({
  rotation,
  visible,
  onClose,
}: {
  rotation: RotationData | null;
  visible: boolean;
  onClose: () => void;
}) {
  if (!rotation) return null;

  const statusColor =
    rotation.status === 'active'
      ? '#10B981'
      : rotation.status === 'completed'
        ? '#6B7280'
        : '#F59E0B';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-end bg-black/50">
        <View
          className="rounded-t-3xl p-6"
          style={{ backgroundColor: clinicalTokens.colors.neutral.dark }}
        >
          <View className="w-12 h-1 bg-gray-600 rounded-full self-center mb-4" />

          <Text
            className="text-white text-xl mb-1"
            style={{ fontFamily: clinicalTokens.fonts.heading }}
          >
            {rotation.title}
          </Text>

          {rotation.specialty && (
            <Text
              className="text-primary text-sm mb-4"
              style={{ fontFamily: clinicalTokens.fonts.body }}
            >
              {rotation.specialty}
            </Text>
          )}

          <View className="flex-row items-center mb-4">
            <View
              className="rounded-full px-3 py-1"
              style={{ backgroundColor: statusColor + '20' }}
            >
              <Text
                className="text-xs"
                style={{ fontFamily: clinicalTokens.fonts.body, color: statusColor }}
              >
                {rotation.status.charAt(0).toUpperCase() + rotation.status.slice(1)}
              </Text>
            </View>
          </View>

          <View className="mb-4">
            <DetailRow
              label="Start Date"
              value={new Date(rotation.start_date).toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            />
            <DetailRow
              label="End Date"
              value={new Date(rotation.end_date).toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            />
            {rotation.site && <DetailRow label="Site" value={rotation.site} />}
          </View>

          {rotation.notes && (
            <View className="mb-4">
              <Text
                className="text-gray-400 text-xs mb-1"
                style={{ fontFamily: clinicalTokens.fonts.body }}
              >
                Notes
              </Text>
              <Text
                className="text-sm"
                style={{ fontFamily: clinicalTokens.fonts.body }}
              >
                {rotation.notes}
              </Text>
            </View>
          )}

          <TouchableOpacity
            className="bg-primary rounded-xl py-3 items-center mt-2"
            onPress={onClose}
            accessibilityLabel="Close rotation details"
            accessibilityRole="button"
          >
            <Text
              className="text-white"
              style={{ fontFamily: clinicalTokens.fonts.heading }}
            >
              Close
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="py-1.5">
      <Text
        className="text-gray-500 text-xs"
        style={{ fontFamily: clinicalTokens.fonts.body }}
      >
        {label}
      </Text>
      <Text
        className="text-white text-sm mt-0.5"
        style={{ fontFamily: clinicalTokens.fonts.body }}
      >
        {value}
      </Text>
    </View>
  );
}

// ── Main Screen ──────────────────────────────────────────────────────

export default function RotationsScreen() {
  const today = new Date();
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [rotations, setRotations] = useState<RotationData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedRotation, setSelectedRotation] = useState<RotationData | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

  const loadRotations = useCallback(async () => {
    setError(null);
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
        .select('id, tenant_id')
        .eq('user_id', user.id)
        .single();

      if (!profile) {
        setLoading(false);
        return;
      }

      // Build query — residents see their own, supervisors/directors see tenant-wide
      let query = supabase
        .from('rotations')
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .order('start_date', { ascending: false });

      // Resident role scoping (fetch role to determine)
      const { data: roleProfile } = await supabase
        .from('profiles')
        .select('role')
        .eq('user_id', user.id)
        .single();

      if (roleProfile && roleProfile.role === 'resident') {
        query = query.eq('resident_id', profile.id);
      }

      const { data, error: fetchError } = await query;

      if (fetchError) {
        setError(fetchError.message);
      } else {
        setRotations((data ?? []) as RotationData[]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load rotations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRotations();
  }, [loadRotations]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadRotations();
    setRefreshing(false);
  }, [loadRotations]);

  const goPrevMonth = useCallback(() => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear((y) => y - 1);
    } else {
      setCurrentMonth((m) => m - 1);
    }
  }, [currentMonth]);

  const goNextMonth = useCallback(() => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear((y) => y + 1);
    } else {
      setCurrentMonth((m) => m + 1);
    }
  }, [currentMonth]);

  const handleRotationTap = useCallback((r: RotationData) => {
    setSelectedRotation(r);
    setModalVisible(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setModalVisible(false);
    setSelectedRotation(null);
  }, []);

  if (loading) {
    return (
      <View
        className="flex-1 items-center justify-center"
        style={{ backgroundColor: clinicalTokens.colors.backdrop.dark }}
      >
        <ActivityIndicator color={clinicalTokens.colors.primary.DEFAULT} size="large" />
      </View>
    );
  }

  return (
    <View
      className="flex-1"
      style={{ backgroundColor: clinicalTokens.colors.backdrop.dark }}
    >
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
        <Text
          className="text-white text-2xl mb-4"
          style={{ fontFamily: clinicalTokens.fonts.heading }}
        >
          Rotations
        </Text>

        {/* Error state */}
        {error && (
          <View className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-4">
            <Text
              className="text-red-400 text-sm"
              style={{ fontFamily: clinicalTokens.fonts.body }}
            >
              {error}
            </Text>
          </View>
        )}

        {/* Month header */}
        <View className="flex-row items-center justify-between mb-4">
          <TouchableOpacity
            onPress={goPrevMonth}
            className="p-2"
            accessibilityLabel="Previous month"
            accessibilityRole="button"
          >
            <Text className="text-primary text-xl">{'◀'}</Text>
          </TouchableOpacity>

          <Text
            className="text-white text-lg"
            style={{ fontFamily: clinicalTokens.fonts.heading }}
          >
            {new Date(currentYear, currentMonth).toLocaleDateString('en-US', {
              month: 'long',
              year: 'numeric',
            })}
          </Text>

          <TouchableOpacity
            onPress={goNextMonth}
            className="p-2"
            accessibilityLabel="Next month"
            accessibilityRole="button"
          >
            <Text className="text-primary text-xl">{'▶'}</Text>
          </TouchableOpacity>
        </View>

        {/* Empty state */}
        {rotations.length === 0 && !error && (
          <View className="bg-white/5 rounded-xl p-6 border border-gray-700/50 items-center mb-4">
            <Text
              className="text-gray-500 text-sm"
              style={{ fontFamily: clinicalTokens.fonts.body }}
            >
              No rotations found for this period.
            </Text>
          </View>
        )}

        {/* Calendar */}
        {rotations.length > 0 && (
          <MonthCalendar
            year={currentYear}
            month={currentMonth}
            rotations={rotations}
            onRotationTap={handleRotationTap}
          />
        )}
      </ScrollView>

      {/* Detail modal */}
      <RotationDetailModal
        rotation={selectedRotation}
        visible={modalVisible}
        onClose={handleCloseModal}
      />
    </View>
  );
}
