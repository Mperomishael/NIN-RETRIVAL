insert into public.services (id, name, description, category, price_kobo, enabled, updated_at)
values (
  'nin-image-report',
  'NIN Image & Written Report',
  'Verification result formatted as a readable report with a provider-returned image when available.',
  'Verification',
  35000,
  true,
  now()
)
on conflict (id) do nothing;
