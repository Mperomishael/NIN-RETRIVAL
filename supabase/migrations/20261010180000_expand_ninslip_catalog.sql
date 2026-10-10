insert into public.services (id, name, description, category, price_kobo, enabled, requires_manual_review)
values
  ('phone-slip', 'Phone NIN Slip Generation', 'Generate an eligible NIN slip using an authorized phone-number request.', 'Documents', 0, false, false),
  ('tracking-id-lookup', 'Tracking ID Verification', 'Verify an eligible identity record using its provider-issued tracking ID.', 'Verification', 0, false, false)
on conflict (id) do nothing;
