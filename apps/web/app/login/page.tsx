'use client';

import { createClient } from '@/lib/supabase/client';
import { Button, Card, CardBody, CardHeader, Input } from '@heroui/react';
import { useState } from 'react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  const handleLogin = async () => {
    setLoading(true);
    await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    setSent(true);
    setLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="flex-col gap-1">
          <h1 className="text-2xl font-bold">E-Logbook</h1>
          <p className="text-sm text-default-500">Sign in to your account</p>
        </CardHeader>
        <CardBody className="gap-4">
          {sent ? (
            <div className="text-center text-success">
              <p>Check your email for a magic link!</p>
            </div>
          ) : (
            <>
              <Input type="email" label="Email" value={email} onValueChange={setEmail} placeholder="doctor@hospital.org" />
              <Button color="primary" isLoading={loading} onPress={handleLogin} isDisabled={!email}>Send Magic Link</Button>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
