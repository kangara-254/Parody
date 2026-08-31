import type { SupabaseClient } from "@supabase/supabase-js";
import { Learner } from "../types";

// Historical exam results and report forms need "who was actually in
// this class when this exam happened" -- NOT "who is currently in this
// class". Without this, a learner who has since been promoted (or
// graduated, or transferred) silently vanishes from a past exam's
// marklist the moment their class_id changes, which is wrong: they
// still sat that exam and their results are still real.
//
// public.enrollments (see supabase/schema.sql migration v5) is the
// permanent per-academic-year record of class membership, kept in sync
// automatically whenever a learner is created or moved. This looks
// learners up through it instead of through learners.class_id directly.
//
// FALLBACK: a database that had exams/marks recorded before migration
// v5 was run won't have enrollment rows for those older years (the
// trigger only started firing once it was created). In that case this
// falls back to the old behaviour (whoever's class_id currently points
// here) so existing report/marklist screens keep working exactly as
// before for pre-migration history, rather than showing an empty
// roster.
export async function fetchHistoricalLearners(
  supabase: SupabaseClient,
  classIds: string[],
  academicYearId: string | undefined | null
): Promise<Learner[]> {
  if (classIds.length === 0) return [];

  if (academicYearId) {
    const { data: enrollments } = await supabase
      .from("enrollments")
      .select("learner_id")
      .in("class_id", classIds)
      .eq("academic_year_id", academicYearId);

    if (enrollments && enrollments.length > 0) {
      const learnerIds = enrollments.map((e: any) => e.learner_id);
      const { data: learners } = await supabase.from("learners").select("*").in("id", learnerIds).order("name");
      return learners || [];
    }
  }

  // Fallback for years predating the enrollments table.
  const { data: learners } = await supabase.from("learners").select("*").in("class_id", classIds).order("name");
  return learners || [];
}
