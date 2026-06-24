import { describe, it, expect } from 'vitest';
import { profileSchema, inviteUserSchema, complianceConfigSchema } from '../auth';

describe('profileSchema', () => {
  it('should accept a valid profile', () => {
    const result = profileSchema.safeParse({
      full_name: 'John Doe',
      specialty: 'Cardiology',
    });
    expect(result.success).toBe(true);
  });

  it('should accept profile without specialty', () => {
    const result = profileSchema.safeParse({
      full_name: 'John Doe',
    });
    expect(result.success).toBe(true);
  });

  it('should reject empty full_name', () => {
    const result = profileSchema.safeParse({
      full_name: '',
    });
    expect(result.success).toBe(false);
  });

  it('should reject name exceeding 100 characters', () => {
    const result = profileSchema.safeParse({
      full_name: 'x'.repeat(101),
    });
    expect(result.success).toBe(false);
  });

  it('should reject null full_name', () => {
    const result = profileSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('inviteUserSchema', () => {
  it('should accept a valid resident invite', () => {
    const result = inviteUserSchema.safeParse({
      email: 'resident@hospital.com',
      role: 'resident',
      full_name: 'Jane Resident',
    });
    expect(result.success).toBe(true);
  });

  it('should accept invite with specialty', () => {
    const result = inviteUserSchema.safeParse({
      email: 'doc@hospital.com',
      role: 'supervisor',
      full_name: 'Dr. Supervisor',
      specialty: 'Neurology',
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid email', () => {
    const result = inviteUserSchema.safeParse({
      email: 'not-an-email',
      role: 'resident',
      full_name: 'Bad Email',
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid role', () => {
    const result = inviteUserSchema.safeParse({
      email: 'user@hospital.com',
      role: 'intern',
      full_name: 'Bad Role',
    });
    expect(result.success).toBe(false);
  });

  it('should reject empty full_name', () => {
    const result = inviteUserSchema.safeParse({
      email: 'user@hospital.com',
      role: 'resident',
      full_name: '',
    });
    expect(result.success).toBe(false);
  });

  it('should reject specialty exceeding 100 characters', () => {
    const result = inviteUserSchema.safeParse({
      email: 'doc@hospital.com',
      role: 'resident',
      full_name: 'Dr. Long Specialty',
      specialty: 'x'.repeat(101),
    });
    expect(result.success).toBe(false);
  });
});

describe('complianceConfigSchema', () => {
  const validConfig = {
    region: 'us-east-1',
    data_retention_days: 365,
    consent_required: true,
    compliance_frameworks: ['hipaa'],
  };

  it('should accept a valid compliance config', () => {
    const result = complianceConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  it('should accept config with multiple frameworks', () => {
    const result = complianceConfigSchema.safeParse({
      ...validConfig,
      compliance_frameworks: ['hipaa', 'gdpr'],
    });
    expect(result.success).toBe(true);
  });

  it('should reject retention below 365', () => {
    const result = complianceConfigSchema.safeParse({
      ...validConfig,
      data_retention_days: 364,
    });
    expect(result.success).toBe(false);
  });

  it('should reject retention above 3650', () => {
    const result = complianceConfigSchema.safeParse({
      ...validConfig,
      data_retention_days: 4000,
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid region', () => {
    const result = complianceConfigSchema.safeParse({
      ...validConfig,
      region: 'us-west-2',
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid compliance framework', () => {
    const result = complianceConfigSchema.safeParse({
      ...validConfig,
      compliance_frameworks: ['iso27001'],
    });
    expect(result.success).toBe(false);
  });
});
