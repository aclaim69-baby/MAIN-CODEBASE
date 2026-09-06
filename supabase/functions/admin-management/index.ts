import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type RequestBody = {
  action: 'upsert' | 'deactivate';
  id?: string;
  admin?: { id?: string; email: string; role: 'junior' | 'senior' };
};

Deno.serve(async (request) => {
  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const authHeader = request.headers.get('Authorization') ?? '';
  const callerClient = createClient(url, serviceKey, { global: { headers: { Authorization: authHeader } } });
  const { data: caller } = await callerClient.auth.getUser();
  if (!caller.user) return Response.json({ error: 'Unauthenticated' }, { status: 401 });

  const admin = createClient(url, serviceKey);
  const { data: callerProfile } = await admin.from('profiles').select('role, active').eq('id', caller.user.id).single();
  if (!callerProfile?.active || callerProfile.role !== 'super_admin') {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json() as RequestBody;
  if (body.action === 'deactivate' && body.id) {
    const { error } = await admin.from('profiles').update({ active: false }).eq('id', body.id).neq('id', caller.user.id);
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ ok: true });
  }
  if (body.action === 'upsert' && body.admin) {
    const email = body.admin.email.trim().toLowerCase();
    if (!email || !['junior', 'senior'].includes(body.admin.role)) return Response.json({ error: 'Invalid administrator' }, { status: 400 });
    const { data: user, error: userError } = await admin.auth.admin.inviteUserByEmail(email);
    if (userError || !user.user) return Response.json({ error: userError?.message ?? 'Unable to create user' }, { status: 400 });
    const { error } = await admin.from('profiles').insert({ id: user.user.id, email, role: body.admin.role, active: true });
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ ok: true, id: user.user.id });
  }
  return Response.json({ error: 'Invalid request' }, { status: 400 });
});
