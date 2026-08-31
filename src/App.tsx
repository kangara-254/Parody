import { useEffect, useState } from "react";
import { useAuth } from "./lib/auth";
import Login from "./pages/Login";
import Shell from "./components/Shell";
import AdminRoleChoice from "./components/AdminRoleChoice";
import Dashboard from "./pages/Dashboard";
import Results from "./pages/Results";
import Profile from "./pages/Profile";
import TeachersPage from "./pages/admin/Teachers";
import ClassesPage from "./pages/admin/Classes";
import LearnersPage from "./pages/admin/Learners";
import ExamsPage from "./pages/admin/Exams";
import OverallMarklist from "./pages/admin/OverallMarklist";
import AcademicYearsPage from "./pages/admin/AcademicYears";
import PromotePage from "./pages/admin/Promote";
import ClassHistoryPage from "./pages/admin/ClassHistory";
import MarkEntry from "./pages/teacher/MarkEntry";
import MyClassLearners from "./pages/teacher/MyClassLearners";
import ReportForms from "./pages/ReportForms";

export default function App() {
  const { user, ready } = useAuth();
  const [view, setView] = useState("dashboard");
  // null = "not chosen yet" -- triggers the AdminRoleChoice prompt for
  // admin accounts. Resets on every fresh login (see the effect below)
  // so the prompt shows every time, per school policy, not just once
  // ever. Plain teacher accounts never use this; effectiveRole below
  // just falls back to "teacher" for them.
  const [adminMode, setAdminMode] = useState<"admin" | "teacher" | null>(null);

  useEffect(() => {
    setAdminMode(null);
    setView("dashboard");
  }, [user?.id]);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-sm text-ink/50 font-body">Loading…</p>
      </div>
    );
  }

  if (!user) return <Login />;

  if (user.role === "admin" && adminMode === null) {
    return <AdminRoleChoice onChoose={setAdminMode} />;
  }

  const effectiveRole: "admin" | "teacher" = user.role === "admin" ? adminMode! : "teacher";

  function handleSwitchMode() {
    setAdminMode(effectiveRole === "admin" ? "teacher" : "admin");
    setView("dashboard");
  }

  function renderView() {
    if (view === "dashboard") return <Dashboard effectiveRole={effectiveRole} />;
    if (view === "results") return <Results />;
    if (view === "reportforms") return <ReportForms />;
    if (view === "profile") return <Profile />;

    if (effectiveRole === "admin") {
      if (view === "teachers") return <TeachersPage />;
      if (view === "classes") return <ClassesPage />;
      if (view === "learners") return <LearnersPage />;
      if (view === "years") return <AcademicYearsPage />;
      if (view === "promote") return <PromotePage />;
      if (view === "classhistory") return <ClassHistoryPage />;
      if (view === "exams") return <ExamsPage />;
      if (view === "overall") return <OverallMarklist />;
    }

    if (effectiveRole === "teacher") {
      if (view === "marks") return <MarkEntry />;
      if (view === "myclass") return <MyClassLearners />;
    }

    return <Dashboard />;
  }

  return (
    <Shell view={view} setView={setView} effectiveRole={effectiveRole} onSwitchMode={user.role === "admin" ? handleSwitchMode : undefined}>
      {renderView()}
    </Shell>
  );
}
