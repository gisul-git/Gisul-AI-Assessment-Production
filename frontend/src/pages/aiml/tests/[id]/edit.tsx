import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/router";
import aimlApi from "../../../../lib/aiml/api";

interface AimlTest {
  id: string;
  title: string;
  description: string;
  duration_minutes: number;
  question_ids?: string[];
}

export default function AimlTestEditPage() {
  const router = useRouter();
  const { id } = router.query;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<AimlTest>({
    id: "",
    title: "",
    description: "",
    duration_minutes: 60,
    question_ids: [],
  });
  const [availableQuestions, setAvailableQuestions] = useState<
    Array<{ id: string; title: string }>
  >([]);

  const fetchTest = useCallback(async () => {
    if (!id || typeof id !== "string") return;
    try {
      setLoading(true);
      setError(null);
      const res = await aimlApi.get(`/tests/${id}`);
      const data = res.data;
      setForm({
        id: data.id,
        title: data.title || "",
        description: data.description || "",
        duration_minutes: data.duration_minutes || 60,
        question_ids: data.question_ids || [],
      });
    } catch (err: any) {
      console.error("Failed to load AIML test:", err);
      setError(err.response?.data?.detail || "Failed to load test");
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchQuestions = useCallback(async () => {
    try {
      const res = await aimlApi.get("/questions");
      const list =
        res.data?.data?.questions ||
        res.data?.questions ||
        res.data ||
        [];
      const mapped = Array.isArray(list)
        ? list.map((q: any) => ({
            id: q.id || q._id,
            title: q.title || "Untitled question",
          }))
        : [];
      setAvailableQuestions(mapped);
    } catch (err) {
      console.error("Failed to load questions", err);
    }
  }, []);

  useEffect(() => {
    fetchTest();
    fetchQuestions();
  }, [fetchTest, fetchQuestions]);

  const handleSave = async () => {
    if (!id || typeof id !== "string") return;
    setSaving(true);
    setError(null);
    try {
      await aimlApi.patch(`/tests/${id}`, {
        title: form.title,
        description: form.description,
        duration_minutes: form.duration_minutes,
        question_ids: form.question_ids,
      });
      alert("Test updated");
      router.push("/aiml/tests");
    } catch (err: any) {
      console.error("Failed to save AIML test:", err);
      setError(err.response?.data?.detail || "Failed to save test");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center text-gray-600">Loading test...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">
              Edit AIML Test
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Update the draft/paused AIML test details.
            </p>
          </div>
          <button
            className="btn-secondary"
            onClick={() => router.push("/aiml/tests")}
          >
            ← Back
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Title
            </label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder="Enter test title"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              value={form.description}
              onChange={(e) =>
                setForm((p) => ({ ...p, description: e.target.value }))
              }
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              rows={4}
              placeholder="Enter test description"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Duration (minutes)
            </label>
            <input
              type="number"
              min={1}
              value={form.duration_minutes}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  duration_minutes: Number(e.target.value),
                }))
              }
              className="w-full max-w-xs rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>

          <div className="flex gap-3">
            <button
              className="btn-primary"
              onClick={handleSave}
              disabled={saving}
              style={{ marginTop: 0 }}
            >
              {saving ? "Saving..." : "Save"}
            </button>
            <button
              className="btn-secondary"
              onClick={() => router.push("/aiml/tests")}
              style={{ marginTop: 0 }}
            >
              Cancel
            </button>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              Add Existing Questions
            </h2>
            <p className="text-sm text-gray-500 mb-3">
              Select existing AIML questions to include in this test.
            </p>
            <div className="space-y-2 max-h-64 overflow-auto border rounded-md p-3">
              {availableQuestions.length === 0 ? (
                <div className="text-sm text-gray-500">
                  No questions available.
                </div>
              ) : (
                availableQuestions.map((q) => {
                  const checked = form.question_ids?.includes(q.id) || false;
                  return (
                    <label
                      key={q.id}
                      className="flex items-center gap-3 text-sm text-gray-800"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setForm((prev) => {
                            const current = prev.question_ids || [];
                            return {
                              ...prev,
                              question_ids: checked
                                ? [...current, q.id]
                                : current.filter((id) => id !== q.id),
                            };
                          });
                        }}
                      />
                      <span>{q.title}</span>
                    </label>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

