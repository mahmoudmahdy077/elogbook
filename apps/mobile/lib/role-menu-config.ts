import type { UserRole } from '@elogbook/shared';
import { Ionicons } from '@expo/vector-icons';

export interface MenuItem {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
  roles: UserRole[];
}

export const SIDE_MENU_ITEMS: MenuItem[] = [
  {
    key: 'my-cases',
    label: 'My Cases',
    icon: 'list',
    route: '/(tabs)/my-cases',
    roles: ['resident'],
  },
  {
    key: 'log-case',
    label: 'Log Case',
    icon: 'add-circle',
    route: '/(tabs)/log-case',
    roles: ['resident'],
  },
  {
    key: 'approvals',
    label: 'Approvals',
    icon: 'checkmark-circle',
    route: '/(tabs)/approvals',
    roles: ['supervisor', 'director', 'institution_admin', 'admin'],
  },
  {
    key: 'rotations',
    label: 'Rotations',
    icon: 'calendar',
    route: '/(tabs)/rotations',
    roles: ['resident', 'supervisor', 'director', 'institution_admin', 'admin'],
  },
  {
    key: 'ai-insights',
    label: 'AI Insights',
    icon: 'sparkles',
    route: '/(tabs)/ai-insights',
    roles: ['resident', 'director', 'admin'],
  },
  {
    key: 'duty-hours',
    label: 'Duty Hours',
    icon: 'time',
    route: '/(tabs)/duty-hours',
    roles: ['resident'],
  },
  {
    key: 'evaluations',
    label: 'Evaluations',
    icon: 'document-text',
    route: '/(tabs)/evaluations',
    roles: ['resident', 'supervisor', 'director', 'admin'],
  },
  {
    key: 'milestones',
    label: 'Milestones',
    icon: 'flag',
    route: '/(tabs)/milestones',
    roles: ['resident', 'supervisor', 'director', 'admin'],
  },
];

export function getFilteredMenuItems(role: UserRole | null): MenuItem[] {
  return SIDE_MENU_ITEMS.filter((item) => role && item.roles.includes(role));
}
