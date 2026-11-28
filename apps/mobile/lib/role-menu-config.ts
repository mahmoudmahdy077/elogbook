import type { MobileFeatureKey, UserRole } from '@elogbook/shared';
import { Ionicons } from '@expo/vector-icons';

export interface MenuItem {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
  roles: UserRole[];
  /** Web-controlled module key (Admin → Mobile App). */
  featureKey: MobileFeatureKey;
}

export const SIDE_MENU_ITEMS: MenuItem[] = [
  {
    key: 'my-cases',
    label: 'My Cases',
    icon: 'list',
    route: '/(tabs)/my-cases',
    featureKey: 'my_cases',
    roles: ['resident'],
  },
  {
    key: 'log-case',
    label: 'Log Case',
    icon: 'add-circle',
    route: '/(tabs)/log-case',
    featureKey: 'log_case',
    roles: ['resident'],
  },
  {
    key: 'approvals',
    label: 'Approvals',
    icon: 'checkmark-circle',
    route: '/(tabs)/approvals',
    featureKey: 'approvals',
    roles: ['supervisor', 'director', 'institution_admin', 'admin'],
  },
  {
    key: 'rotations',
    label: 'Rotations',
    icon: 'calendar',
    route: '/(tabs)/rotations',
    featureKey: 'rotations',
    roles: ['resident', 'supervisor', 'director', 'institution_admin', 'admin'],
  },
  {
    key: 'ai-insights',
    label: 'AI Insights',
    icon: 'sparkles',
    route: '/(tabs)/ai-insights',
    featureKey: 'ai_insights',
    roles: ['resident', 'director', 'admin'],
  },
  {
    key: 'duty-hours',
    label: 'Duty Hours',
    icon: 'time',
    route: '/(tabs)/duty-hours',
    featureKey: 'duty_hours',
    roles: ['resident'],
  },
  {
    key: 'evaluations',
    label: 'Evaluations',
    icon: 'document-text',
    route: '/(tabs)/evaluations',
    featureKey: 'evaluations',
    roles: ['resident', 'supervisor', 'director', 'admin'],
  },
  {
    key: 'milestones',
    label: 'Milestones',
    icon: 'flag',
    route: '/(tabs)/milestones',
    featureKey: 'milestones',
    roles: ['resident', 'supervisor', 'director', 'admin'],
  },
  {
    key: 'reflections',
    label: 'Reflections',
    icon: 'book',
    route: '/(tabs)/reflections',
    featureKey: 'reflections',
    roles: ['resident', 'supervisor', 'director', 'institution_admin', 'admin'],
  },
  {
    key: 'analytics',
    label: 'Analytics',
    icon: 'stats-chart',
    route: '/(tabs)/analytics',
    featureKey: 'analytics',
    roles: ['resident', 'supervisor', 'director', 'institution_admin', 'admin'],
  },
];

export function getFilteredMenuItems(
  role: UserRole | null,
  isEnabled: (key: MobileFeatureKey) => boolean = () => true,
): MenuItem[] {
  return SIDE_MENU_ITEMS.filter(
    (item) => role && item.roles.includes(role) && isEnabled(item.featureKey),
  );
}
