import { createServerSupabase } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';

export async function POST() {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  revalidatePath('/');
  return NextResponse.redirect(new URL('/login', process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'));
}
