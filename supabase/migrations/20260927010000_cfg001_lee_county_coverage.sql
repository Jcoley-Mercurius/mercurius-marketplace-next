-- CFG-001 / DEC-2026-021: commit the private-beta ZIP allowlist (every Lee County, Florida ZIP).
--
-- Before this migration no coverage ZIP was committed; coverage_areas held only whatever an
-- admin had entered in each environment, so a clean database covered nothing.
--
-- Now the 47 ZIP codes the USPS assigns to Lee County (33 standard, 1 unique, 13 PO box) are
-- active coverage. Source and boundary rules are recorded in DEC-2026-021:
-- * Census 2020 ZCTAs 33955 (Charlotte), 34110 and 34119 (Collier) have slivers of Lee County
--   land (1.5%, 5.2%, 1.8%) but are not Lee County ZIPs and are not added.
-- * Split ZIPs assigned to Lee County (33917, 33921, 33936, 34134) are covered whole, because
--   enforcement is ZIP-level (CFG-001).
--
-- Additive only. Existing rows for these ZIPs keep their id and city and become active with no
-- waitlist. Rows for other ZIPs are not changed or removed; reconciling a hosted environment's
-- existing rows against this list is part of its reviewed migration (Phase 8).
-- Forward recovery: correct a ZIP with a later migration; do not edit this one.

insert into public.coverage_areas (zip_code, city, state, is_active, has_waitlist)
values
  -- Standard
  ('33901', 'Fort Myers', 'FL', true, false),
  ('33903', 'North Fort Myers', 'FL', true, false),
  ('33904', 'Cape Coral', 'FL', true, false),
  ('33905', 'Fort Myers', 'FL', true, false),
  ('33907', 'Fort Myers', 'FL', true, false),
  ('33908', 'Fort Myers', 'FL', true, false),
  ('33909', 'Cape Coral', 'FL', true, false),
  ('33912', 'Fort Myers', 'FL', true, false),
  ('33913', 'Fort Myers', 'FL', true, false),
  ('33914', 'Cape Coral', 'FL', true, false),
  ('33916', 'Fort Myers', 'FL', true, false),
  ('33917', 'North Fort Myers', 'FL', true, false),
  ('33919', 'Fort Myers', 'FL', true, false),
  ('33920', 'Alva', 'FL', true, false),
  ('33922', 'Bokeelia', 'FL', true, false),
  ('33928', 'Estero', 'FL', true, false),
  ('33931', 'Fort Myers Beach', 'FL', true, false),
  ('33936', 'Lehigh Acres', 'FL', true, false),
  ('33956', 'Saint James City', 'FL', true, false),
  ('33957', 'Sanibel', 'FL', true, false),
  ('33966', 'Fort Myers', 'FL', true, false),
  ('33967', 'Fort Myers', 'FL', true, false),
  ('33971', 'Lehigh Acres', 'FL', true, false),
  ('33972', 'Lehigh Acres', 'FL', true, false),
  ('33973', 'Lehigh Acres', 'FL', true, false),
  ('33974', 'Lehigh Acres', 'FL', true, false),
  ('33976', 'Lehigh Acres', 'FL', true, false),
  ('33990', 'Cape Coral', 'FL', true, false),
  ('33991', 'Cape Coral', 'FL', true, false),
  ('33993', 'Cape Coral', 'FL', true, false),
  ('34134', 'Bonita Springs', 'FL', true, false),
  ('34135', 'Bonita Springs', 'FL', true, false),
  -- Unique
  ('33965', 'Fort Myers', 'FL', true, false),
  -- PO box
  ('33902', 'Fort Myers', 'FL', true, false),
  ('33906', 'Fort Myers', 'FL', true, false),
  ('33910', 'Cape Coral', 'FL', true, false),
  ('33915', 'Cape Coral', 'FL', true, false),
  ('33918', 'North Fort Myers', 'FL', true, false),
  ('33921', 'Boca Grande', 'FL', true, false),
  ('33924', 'Captiva', 'FL', true, false),
  ('33929', 'Estero', 'FL', true, false),
  ('33932', 'Fort Myers Beach', 'FL', true, false),
  ('33945', 'Pineland', 'FL', true, false),
  ('33970', 'Lehigh Acres', 'FL', true, false),
  ('33994', 'Fort Myers', 'FL', true, false),
  ('34133', 'Bonita Springs', 'FL', true, false),
  ('34136', 'Bonita Springs', 'FL', true, false)
on conflict (zip_code) do update
  set is_active = true, has_waitlist = false;
