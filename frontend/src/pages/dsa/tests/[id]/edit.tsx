'use client'

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { GetServerSideProps } from "next";
import { requireAuth } from "../../../../lib/auth";
import dsaApi from "../../../../lib/dsa/api";

interface Question {
  id: string;
  title: string;
  difficulty: string;
}

type TimerMode = "GLOBAL" | "PER_QUESTION";
type ExamMode = "strict" | "flexible";

interface QuestionTiming {
  question_id: string;
  duration_minutes: number;
}

interface DSATest {
  id: string;
  title: string;
  description: string;
  question_ids: string[];
  duration_minutes: number;
  start_time: string | null;
  end_time: string | null;
  examMode?: ExamMode;
  schedule?: { startTime?: string; endTime?: string; duration?: number } | null;
  question_time_limits?: Record<string, number> | null;
}

export default function EditDSACompetencyPage() {
  const router = useRouter();
  const { id } = router.query;
  const testId = typeof id === "string" ? id : null;

  const [loading, setLoading] = useState(false);
  const [loadingTest, setLoadingTest] = useState(true);
  const [questions, setQuestions] = useState<Question[]>([]);

  // Timer/exam config (must mirror backend semantics)
  const [timerMode, setTimerMode] = useState<TimerMode>("GLOBAL");
  const [questionTimings, setQuestionTimings] = useState<Record<string, number>>({});
  const [examMode, setExamMode] = useState<ExamMode>("strict");

  const [formData, setFormData] = useState({
    title: "",
    description: "",
    question_ids: [] as string[],
    duration_minutes: 60,
    start_time: "",
    end_time: "",
  });

  const selectedQuestions = useMemo(
    () => questions.filter((q) => formData.question_ids.includes(q.id)),
    [questions, formData.question_ids]
  );

  const calculateTotalDuration = () => {
    return formData.question_ids.reduce((sum, qid) => sum + (questionTimings[qid] || 0), 0);
  };

  const fetchQuestions = async () => {
    try {
      const response = await dsaApi.get("/questions/");
      setQuestions(response.data);
    } catch (error) {
      console.error("Error fetching questions:", error);
    }
  };

  const hydrateFromTest = (test: DSATest) => {
    const start = test.start_time ? new Date(test.start_time) : null;
    const end = test.end_time ? new Date(test.end_time) : null;

    setFormData({
      title: test.title || "",
      description: test.description || "",
      question_ids: test.question_ids || [],
      duration_minutes: test.duration_minutes || 60,
      start_time: start ? new Date(start.getTime() - start.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "",
      end_time: end ? new Date(end.getTime() - end.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "",
    });

    const mode = (test.examMode as ExamMode) || "strict";
    setExamMode(mode);

    const limits = test.question_time_limits || null;
    if (limits && Object.keys(limits).length > 0) {
      setTimerMode("PER_QUESTION");
      setQuestionTimings(limits);
    } else {
      setTimerMode("GLOBAL");
      setQuestionTimings({});
    }
  };

  const fetchTest = async (tid: string) => {
    try {
      const res = await dsaApi.get(`/tests/${tid}`);
      hydrateFromTest(res.data);
    } catch (err: any) {
      console.error("Error fetching test:", err);
      alert(err?.response?.data?.detail || "Failed to load test");
      router.push("/dsa/tests");
    } finally {
      setLoadingTest(false);
    }
  };

  useEffect(() => {
    fetchQuestions();
  }, []);

  useEffect(() => {
    if (!testId) return;
    fetchTest(testId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testId) return;

    if (!formData.start_time || !formData.end_time) {
      alert("Start time and end time are required.");
      return;
    }
    if (new Date(formData.start_time) >= new Date(formData.end_time)) {
      alert("End time must be after start time.");
      return;
    }

    if (examMode === "flexible") {
      const durationForSchedule =
        timerMode === "PER_QUESTION" ? calculateTotalDuration() : formData.duration_minutes;
      if (!durationForSchedule || durationForSchedule < 1) {
        alert("Duration is required for flexible exam mode.");
        return;
      }
    }

    if (timerMode === "PER_QUESTION") {
      for (const qid of formData.question_ids) {
        const timing = questionTimings[qid];
        if (!timing || timing < 1) {
          alert(`Please set a valid duration (at least 1 minute) for all questions`);
          return;
        }
      }
    }

    setLoading(true);
    try {
      const payload: any = {
        ...formData,
        examMode,
        schedule: {
          startTime: formData.start_time ? new Date(formData.start_time).toISOString() : undefined,
          endTime: formData.end_time ? new Date(formData.end_time).toISOString() : undefined,
          duration:
            examMode === "flexible"
              ? timerMode === "PER_QUESTION"
                ? calculateTotalDuration()
                : formData.duration_minutes
              : undefined,
        },
      };

      if (timerMode === "PER_QUESTION") {
        payload.timer_mode = "PER_QUESTION";
        payload.question_timings = formData.question_ids.map((qid) => ({
          question_id: qid,
          duration_minutes: questionTimings[qid],
        })) as QuestionTiming[];
      } else {
        payload.timer_mode = "GLOBAL";
        payload.question_timings = null;
      }

      await dsaApi.put(`/tests/${testId}`, payload);
      alert("Test updated successfully!");
      router.push(`/dsa/tests?testId=${encodeURIComponent(String(testId))}&refreshed=true`);
    } catch (error: any) {
      console.error("Update error:", error);
      alert(error.response?.data?.detail || "Failed to update test");
    } finally {
      setLoading(false);
    }
  };

  if (loadingTest) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container mx-auto px-4 py-8">
          <div className="text-center">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        <div style={{ marginBottom: "1.5rem" }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => router.push(`/dsa/tests?testId=${encodeURIComponent(String(testId))}`)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
            }}
          >
            ← Back to Test Management
          </button>
        </div>

        <h1 className="text-3xl font-bold mb-2">Edit DSA Competency Test</h1>
        <p className="text-muted-foreground mb-6">
          Update test details for this assessment ID only.
        </p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="block font-medium">Title</label>
            <input
              className="input"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              required
            />
          </div>

          <div className="space-y-2">
            <label className="block font-medium">Description</label>
            <textarea
              className="input"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={3}
              required
            />
          </div>

          <div className="space-y-2">
            <label className="block font-medium">Exam Window Configuration</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={examMode === "strict"}
                  onChange={() => setExamMode("strict")}
                />
                Strict Window
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={examMode === "flexible"}
                  onChange={() => setExamMode("flexible")}
                />
                Flexible Window
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              Strict: candidates must submit within start/end. Flexible: candidates can start any time in window and get a fixed duration.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="block font-medium">Start Time</label>
              <input
                type="datetime-local"
                className="input"
                value={formData.start_time}
                onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <label className="block font-medium">End Time</label>
              <input
                type="datetime-local"
                className="input"
                value={formData.end_time}
                onChange={(e) => setFormData({ ...formData, end_time: e.target.value })}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="block font-medium">Timer Configuration</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={timerMode === "GLOBAL"}
                  onChange={() => setTimerMode("GLOBAL")}
                />
                Global Timer
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={timerMode === "PER_QUESTION"}
                  onChange={() => setTimerMode("PER_QUESTION")}
                />
                Per-Question Timer
              </label>
            </div>
          </div>

          {timerMode === "GLOBAL" && (
            <div className="space-y-2">
              <label className="block font-medium">Duration (minutes)</label>
              <input
                type="number"
                className="input"
                value={formData.duration_minutes}
                onChange={(e) => setFormData({ ...formData, duration_minutes: Number(e.target.value) })}
                min={1}
                required
              />
            </div>
          )}

          <div className="space-y-2">
            <label className="block font-medium">Questions</label>
            <div className="space-y-2">
              {questions.map((q) => {
                const checked = formData.question_ids.includes(q.id);
                return (
                  <label key={q.id} className="flex items-center gap-3 border rounded p-3">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...formData.question_ids, q.id]
                          : formData.question_ids.filter((x) => x !== q.id);
                        setFormData({ ...formData, question_ids: next });
                      }}
                    />
                    <div className="flex-1">
                      <div className="font-medium">{q.title}</div>
                      <div className="text-xs text-muted-foreground">Difficulty: {q.difficulty}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {timerMode === "PER_QUESTION" && selectedQuestions.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-semibold">Per-Question Timings (minutes)</h3>
              {selectedQuestions.map((q) => (
                <div key={q.id} className="flex items-center justify-between border rounded p-3">
                  <div className="font-medium">{q.title}</div>
                  <input
                    type="number"
                    className="input"
                    style={{ width: 120 }}
                    min={1}
                    value={questionTimings[q.id] || ""}
                    onChange={(e) =>
                      setQuestionTimings({ ...questionTimings, [q.id]: Number(e.target.value) })
                    }
                    required
                  />
                </div>
              ))}
              <div className="text-sm text-muted-foreground">
                Total duration: <span className="font-medium">{calculateTotalDuration()}</span> minutes
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? "Saving..." : "Save Changes"}
            </button>
            <button type="button" className="btn-secondary" onClick={() => router.push("/dsa/tests")}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export const getServerSideProps: GetServerSideProps = requireAuth;
