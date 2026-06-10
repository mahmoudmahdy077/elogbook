'use client';

import { createClient } from '@/lib/supabase/client';
import { Button, Card, TextField } from '@heroui/react';
import { useState } from 'react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  const handleOtpLogin = async () => {
    setError('');
    setLoading(true);
    await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    setSent(true);
    setLoading(false);
  };

  const handlePasswordLogin = async () => {
    setError('');
    setLoading(true);
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (authError) {
      setError(authError.message);
    } else {
      location.href = '/dashboard';
    }
    setLoading(false);
  };

  const handleSubmit = () => {
    if (password) {
      handlePasswordLogin();
    } else {
      handleOtpLogin();
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <Card.Header className="flex-col gap-1">
          <h1 className="text-2xl font-bold">E-Logbook</h1>
          <p className="text-sm text-default-500">Sign in to your account</p>
        </Card.Header>
        <Card.Content className="gap-4">
          {sent ? (
            <div className="text-center text-success">
              <p>Check your email for a magic link!</p>
            </div>
          ) : (
            <>
              <TextField
                label="Email"
                value={email}
                onChange={setEmail}
                placeholder="doctor@hospital.org"
              />
              <TextField
                type="password"
                label="Password"
                value={password}
                onChange={setPassword}
                placeholder="Leave blank for magic link"
              />
              {error && (
                <p className="text-sm text-danger">{error}</p>
              )}
              <Button
                color="primary"
                isLoading={loading}
                onPress={handleSubmit}
                isDisabled={!email}
              >
                {password ? 'Sign In' : 'Send Magic Link'}
              </Button>
            </>
          )}
        </Card.Content>
      </Card>
    </div>
  );
}
