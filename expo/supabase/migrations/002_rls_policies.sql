-- ============================================================
-- AI Longevity Pro - Row Level Security Policies
-- Run this AFTER 001_initial_schema.sql
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.practitioner_patient_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lifestyle_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contraindications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questionnaire_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinical_intakes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wearable_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_health_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_biometric_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meal_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_nutrition_rollups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplement_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_supplement_rollups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.symptom_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_subjective_rollups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_markers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_panels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.detected_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.correlations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.practitioner_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.protocols ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_adherence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hormone_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- PROFILES (id = auth.uid())
-- ============================================================
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (id = auth.uid() OR public.is_admin());
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (id = auth.uid());
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (id = auth.uid());
CREATE POLICY "Practitioners can view assigned patients" ON public.profiles FOR SELECT USING (
  public.is_practitioner() AND public.is_assigned_patient(auth.uid(), id)
);

-- ============================================================
-- USER ROLES
-- ============================================================
CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "Only admins can manage roles" ON public.user_roles FOR ALL USING (public.is_admin());

-- ============================================================
-- PRACTITIONER ASSIGNMENTS
-- ============================================================
CREATE POLICY "Practitioners can view own assignments" ON public.practitioner_patient_assignments FOR SELECT USING (
  practitioner_id = auth.uid() OR patient_id = auth.uid() OR public.is_admin()
);
CREATE POLICY "Only admins can manage assignments" ON public.practitioner_patient_assignments FOR ALL USING (public.is_admin());

-- ============================================================
-- GENERIC USER-OWNED TABLE POLICIES (user_id = auth.uid())
-- Applied to all tables with user_id column
-- ============================================================

-- health_goals
CREATE POLICY "Own data select" ON public.health_goals FOR SELECT USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "Own data insert" ON public.health_goals FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Own data update" ON public.health_goals FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Own data delete" ON public.health_goals FOR DELETE USING (user_id = auth.uid());

-- lifestyle_profiles
CREATE POLICY "Own data select" ON public.lifestyle_profiles FOR SELECT USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "Own data insert" ON public.lifestyle_profiles FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Own data update" ON public.lifestyle_profiles FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Own data delete" ON public.lifestyle_profiles FOR DELETE USING (user_id = auth.uid());

-- contraindications
CREATE POLICY "Own data select" ON public.contraindications FOR SELECT USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "Own data insert" ON public.contraindications FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Own data update" ON public.contraindications FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Own data delete" ON public.contraindications FOR DELETE USING (user_id = auth.uid());

-- questionnaire_responses
CREATE POLICY "Own data select" ON public.questionnaire_responses FOR SELECT USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "Own data insert" ON public.questionnaire_responses FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Own data update" ON public.questionnaire_responses FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Own data delete" ON public.questionnaire_responses FOR DELETE USING (user_id = auth.uid());

-- clinical_intakes
CREATE POLICY "Own data select" ON public.clinical_intakes FOR SELECT USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "Own data insert" ON public.clinical_intakes FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Own data update" ON public.clinical_intakes FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Own data delete" ON public.clinical_intakes FOR DELETE USING (user_id = auth.uid());

-- wearable_connections
CREATE POLICY "Own data select" ON public.wearable_connections FOR SELECT USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "Own data insert" ON public.wearable_connections FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Own data update" ON public.wearable_connections FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Own data delete" ON public.wearable_connections FOR DELETE USING (user_id = auth.uid());

-- raw_health_events
CREATE POLICY "Own data select" ON public.raw_health_events FOR SELECT USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "Own data insert" ON public.raw_health_events FOR INSERT WITH CHECK (user_id = auth.uid());

-- daily_biometric_records
CREATE POLICY "Own data select" ON public.daily_biometric_records FOR SELECT USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "Own data insert" ON public.daily_biometric_records FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Own data update" ON public.daily_biometric_records FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Own data delete" ON public.daily_biometric_records FOR DELETE USING (user_id = auth.uid());

-- meal_logs
CREATE POLICY "Own data select" ON public.meal_logs FOR SELECT USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "Own data insert" ON public.meal_logs FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Own data update" ON public.meal_logs FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Own data delete" ON public.meal_logs FOR DELETE USING (user_id = auth.uid());

-- daily_nutrition_rollups
CREATE POLICY "Own data select" ON public.daily_nutrition_rollups FOR SELECT USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "Own data insert" ON public.daily_nutrition_rollups FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Own data update" ON public.daily_nutrition_rollups FOR UPDATE USING (user_id = auth.uid());

-- supplement_logs
CREATE POLICY "Own data select" ON public.supplement_logs FOR SELECT USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "Own data insert" ON public.supplement_logs FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Own data update" ON public.supplement_logs FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Own data delete" ON public.supplement_logs FOR DELETE USING (user_id = auth.uid());

-- daily_supplement_rollups
CREATE POLICY "Own data select" ON public.daily_supplement_rollups FOR SELECT USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "Own data insert" ON public.daily_supplement_rollups FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Own data update" ON public.daily_supplement_rollups FOR UPDATE USING (user_id = auth.uid());

-- symptom_logs
CREATE POLICY "Own data select" ON public.symptom_logs FOR SELECT USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "Own data insert" ON public.symptom_logs FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Own data update" ON public.symptom_logs FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Own data delete" ON public.symptom_logs FOR DELETE USING (user_id = auth.uid());

-- daily_subjective_rollups
CREATE POLICY "Own data select" ON public.daily_subjective_rollups FOR SELECT USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "Own data insert" ON public.daily_subjective_rollups FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Own data update" ON public.daily_subjective_rollups FOR UPDATE USING (user_id = auth.uid());

-- lab_markers
CREATE POLICY "Own data select" ON public.lab_markers FOR SELECT USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "Own data insert" ON public.lab_markers FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Own data update" ON public.lab_markers FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Own data delete" ON public.lab_markers FOR DELETE USING (user_id = auth.uid());

-- lab_panels
CREATE POLICY "Own data select" ON public.lab_panels FOR SELECT USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "Own data insert" ON public.lab_panels FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Own data update" ON public.lab_panels FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Own data delete" ON public.lab_panels FOR DELETE USING (user_id = auth.uid());

-- daily_baselines
CREATE POLICY "Own data select" ON public.daily_baselines FOR SELECT USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "Own data insert" ON public.daily_baselines FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Own data update" ON public.daily_baselines FOR UPDATE USING (user_id = auth.uid());

-- daily_scores
CREATE POLICY "Own data select" ON public.daily_scores FOR SELECT USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "Own data insert" ON public.daily_scores FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Own data update" ON public.daily_scores FOR UPDATE USING (user_id = auth.uid());

-- detected_patterns
CREATE POLICY "Own data select" ON public.detected_patterns FOR SELECT USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "Own data insert" ON public.detected_patterns FOR INSERT WITH CHECK (user_id = auth.uid());

-- correlations
CREATE POLICY "Own data select" ON public.correlations FOR SELECT USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "Own data insert" ON public.correlations FOR INSERT WITH CHECK (user_id = auth.uid());

-- daily_recommendations
CREATE POLICY "Own data select" ON public.daily_recommendations FOR SELECT USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "Own data insert" ON public.daily_recommendations FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Own data update" ON public.daily_recommendations FOR UPDATE USING (user_id = auth.uid());

-- practitioner_flags
CREATE POLICY "Own data select" ON public.practitioner_flags FOR SELECT USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "Own data insert" ON public.practitioner_flags FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Own data update" ON public.practitioner_flags FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Practitioners view assigned patient flags" ON public.practitioner_flags FOR SELECT USING (
  public.is_practitioner() AND public.is_assigned_patient(auth.uid(), user_id)
);

-- notification_queue
CREATE POLICY "Own data select" ON public.notification_queue FOR SELECT USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "Own data insert" ON public.notification_queue FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Own data update" ON public.notification_queue FOR UPDATE USING (user_id = auth.uid());

-- protocols
CREATE POLICY "Own data select" ON public.protocols FOR SELECT USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "Own data insert" ON public.protocols FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Own data update" ON public.protocols FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Own data delete" ON public.protocols FOR DELETE USING (user_id = auth.uid());

-- daily_adherence
CREATE POLICY "Own data select" ON public.daily_adherence FOR SELECT USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "Own data insert" ON public.daily_adherence FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Own data update" ON public.daily_adherence FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Own data delete" ON public.daily_adherence FOR DELETE USING (user_id = auth.uid());

-- hormone_entries
CREATE POLICY "Own data select" ON public.hormone_entries FOR SELECT USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "Own data insert" ON public.hormone_entries FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Own data update" ON public.hormone_entries FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Own data delete" ON public.hormone_entries FOR DELETE USING (user_id = auth.uid());

-- app_settings
CREATE POLICY "Own data select" ON public.app_settings FOR SELECT USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "Own data insert" ON public.app_settings FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Own data update" ON public.app_settings FOR UPDATE USING (user_id = auth.uid());

-- subscriptions
CREATE POLICY "Own data select" ON public.subscriptions FOR SELECT USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "Own data insert" ON public.subscriptions FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Own data update" ON public.subscriptions FOR UPDATE USING (user_id = auth.uid());

-- ============================================================
-- STORAGE BUCKETS (run in SQL editor)
-- ============================================================
-- INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', true);
-- INSERT INTO storage.buckets (id, name, public) VALUES ('lab_uploads', 'lab_uploads', false);
-- INSERT INTO storage.buckets (id, name, public) VALUES ('meal_images', 'meal_images', false);
-- INSERT INTO storage.buckets (id, name, public) VALUES ('practitioner_documents', 'practitioner_documents', false);

-- Storage policies for avatars (public read, owner write)
-- CREATE POLICY "Avatar public read" ON storage.objects FOR SELECT USING (bucket_id = 'avatars');
-- CREATE POLICY "Avatar owner write" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);
-- CREATE POLICY "Avatar owner update" ON storage.objects FOR UPDATE USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);
-- CREATE POLICY "Avatar owner delete" ON storage.objects FOR DELETE USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Storage policies for private buckets (owner only)
-- CREATE POLICY "Private read" ON storage.objects FOR SELECT USING (bucket_id IN ('lab_uploads', 'meal_images') AND auth.uid()::text = (storage.foldername(name))[1]);
-- CREATE POLICY "Private write" ON storage.objects FOR INSERT WITH CHECK (bucket_id IN ('lab_uploads', 'meal_images') AND auth.uid()::text = (storage.foldername(name))[1]);
-- CREATE POLICY "Private delete" ON storage.objects FOR DELETE USING (bucket_id IN ('lab_uploads', 'meal_images') AND auth.uid()::text = (storage.foldername(name))[1]);
