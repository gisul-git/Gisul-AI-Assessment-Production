import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { GetServerSideProps } from "next";
import { requireAuth } from "../../lib/auth";
import aimlApi from "../../lib/aiml/api";

interface Question {
  id: string;
  title: string;
  difficulty: string;
  library?: string;
  ai_generated?: boolean;
}

export default function CreateAIMLCompetencyPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [questions, setQuestions] = useState<Question[]>([]);
  
  // Timer mode state (mirrors DSA)
  type TimerMode = "GLOBAL" | "PER_QUESTION";
  const [timerMode, setTimerMode] = useState<TimerMode>("GLOBAL");
  const [questionTimings, setQuestionTimings] = useState<Record<string, number>>({});

  // Exam window configuration (mirrors Custom MCQ)
  type ExamMode = "strict" | "flexible";
  const [examMode, setExamMode] = useState<ExamMode>("strict");

  const [formData, setFormData] = useState({
    title: "",
    description: "",
    question_ids: [] as string[],
    duration_minutes: 60,
    start_time: "",
    end_time: "",
  });

  useEffect(() => {
    fetchQuestions();
    
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchQuestions();
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    const handleFocus = () => {
      fetchQuestions();
    };
    
    window.addEventListener('focus', handleFocus);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  const fetchQuestions = async () => {
    try {
      const response = await aimlApi.get("/questions/");
      setQuestions(response.data);
    } catch (error) {
      console.error("Error fetching questions:", error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Exam window validation
    if (!formData.start_time || !formData.end_time) {
      alert("Start time and end time are required.");
      return;
    }
    if (new Date(formData.start_time) >= new Date(formData.end_time)) {
      alert("End time must be after start time.");
      return;
    }
    if (examMode === "flexible") {
      const durationForSchedule = timerMode === "PER_QUESTION"
        ? calculateTotalDuration()
        : formData.duration_minutes;
      if (!durationForSchedule || durationForSchedule < 1) {
        alert("Duration is required for flexible exam mode.");
        return;
      }
    }
    // Per-question validation
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
      // Create the test
      const durationForSchedule =
        examMode === "flexible"
          ? (timerMode === "PER_QUESTION" ? calculateTotalDuration() : formData.duration_minutes)
          : null;

      const payload: any = {
        ...formData,
        start_time: new Date(formData.start_time).toISOString(),
        end_time: new Date(formData.end_time).toISOString(),
        // Scheduling payload (mirrors Custom MCQ)
        examMode,
        schedule: {
          startTime: new Date(formData.start_time).toISOString(),
          endTime: new Date(formData.end_time).toISOString(),
          duration: durationForSchedule,
        },
        startTime: new Date(formData.start_time).toISOString(),
        endTime: new Date(formData.end_time).toISOString(),
        duration: durationForSchedule,
        // Timer payload (mirrors DSA)
        timer_mode: timerMode,
      };

      if (timerMode === "PER_QUESTION") {
        payload.question_timings = formData.question_ids.map(qid => ({
          question_id: qid,
          duration_minutes: questionTimings[qid] || 10,
        }));
        payload.duration_minutes = calculateTotalDuration();
      }

      const response = await aimlApi.post("/tests/", payload);
      
      const testId = response.data?.id || response.data?._id;
      
      // Automatically publish the test
      if (testId) {
        try {
          await aimlApi.patch(`/tests/${testId}/publish?is_published=true`);
        } catch (publishError: any) {
          console.error("Error publishing test:", publishError);
        }
      }
      
      // Redirect to dashboard
      alert("Test created and published successfully!");
      router.push("/dashboard");
    } catch (error: any) {
      alert(error.response?.data?.detail || error.response?.data?.message || "Failed to create AIML competency test");
      setLoading(false);
    }
  };

  const toggleQuestion = (questionId: string) => {
    if (formData.question_ids.includes(questionId)) {
      setFormData({
        ...formData,
        question_ids: formData.question_ids.filter((id) => id !== questionId),
      });
      const newTimings = { ...questionTimings };
      delete newTimings[questionId];
      setQuestionTimings(newTimings);
    } else {
      setFormData({
        ...formData,
        question_ids: [...formData.question_ids, questionId],
      });
      setQuestionTimings({
        ...questionTimings,
        [questionId]: 10,
      });
    }
  };

  const updateQuestionTiming = (questionId: string, minutes: number) => {
    setQuestionTimings({
      ...questionTimings,
      [questionId]: Math.max(1, minutes),
    });
  };

  const calculateTotalDuration = (): number => {
    return formData.question_ids.reduce((total, qid) => total + (questionTimings[qid] || 10), 0);
  };

  const handleDeleteQuestion = async (questionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!confirm('Are you sure you want to delete this question? This action cannot be undone.')) {
      return;
    }

    try {
      await aimlApi.delete(`/questions/${questionId}`);
      
      if (formData.question_ids.includes(questionId)) {
        setFormData({
          ...formData,
          question_ids: formData.question_ids.filter((id) => id !== questionId),
        });
      }
      
      await fetchQuestions();
      alert('Question deleted successfully!');
    } catch (error: any) {
      alert(error.response?.data?.detail || error.response?.data?.message || 'Failed to delete question');
    }
  };

  return (
    <div style={{ backgroundColor: "#ffffff", minHeight: "100vh" }}>
      <div className="container" style={{ paddingTop: "2rem", paddingBottom: "2rem" }}>
        <div style={{ marginBottom: "1.5rem" }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => router.back()}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
            }}
          >
            ← Back
          </button>
        </div>

        <div className="card">
          <h1 style={{ marginBottom: "2rem", color: "#1a1625" }}>Create AIML Competency Test</h1>
          
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: "1.5rem" }}>
              <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600 }}>
                Test Title *
              </label>
              <input
                type="text"
                required
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                style={{
                  width: "100%",
                  padding: "0.75rem",
                  border: "1px solid #A8E8BC",
                  borderRadius: "0.375rem",
                }}
                placeholder="e.g., NumPy and Matplotlib Assessment"
              />
            </div>

            <div style={{ marginBottom: "1.5rem" }}>
              <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600 }}>
                Description
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                style={{
                  width: "100%",
                  padding: "0.75rem",
                  border: "1px solid #A8E8BC",
                  borderRadius: "0.375rem",
                  minHeight: "100px",
                }}
                placeholder="Describe the test..."
              />
            </div>

            {/* Exam Window Configuration */}
            <div style={{ marginBottom: "1.5rem", padding: "1.25rem", border: "1px solid #A8E8BC", borderRadius: "0.5rem" }}>
              <h3 style={{ marginBottom: "1rem", color: "#1E5A3B" }}>Exam Window Configuration</h3>
              <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
                <label style={{ flex: 1, padding: "1rem", border: examMode === "strict" ? "2px solid #2D7A52" : "1px solid #A8E8BC", borderRadius: "0.5rem", cursor: "pointer", backgroundColor: examMode === "strict" ? "#E8FAF0" : "#ffffff" }}>
                  <input type="radio" name="examMode" value="strict" checked={examMode === "strict"} onChange={(e) => setExamMode(e.target.value as ExamMode)} style={{ marginRight: "0.5rem" }} />
                  <strong style={{ color: "#1E5A3B" }}>Fixed Window (Strict)</strong>
                </label>
                <label style={{ flex: 1, padding: "1rem", border: examMode === "flexible" ? "2px solid #2D7A52" : "1px solid #A8E8BC", borderRadius: "0.5rem", cursor: "pointer", backgroundColor: examMode === "flexible" ? "#E8FAF0" : "#ffffff" }}>
                  <input type="radio" name="examMode" value="flexible" checked={examMode === "flexible"} onChange={(e) => setExamMode(e.target.value as ExamMode)} style={{ marginRight: "0.5rem" }} />
                  <strong style={{ color: "#1E5A3B" }}>Flexible Window</strong>
                </label>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                <div>
                  <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600 }}>Start Time *</label>
                  <input type="datetime-local" required value={formData.start_time} onChange={(e) => setFormData({ ...formData, start_time: e.target.value })} style={{ width: "100%", padding: "0.75rem", border: "1px solid #A8E8BC", borderRadius: "0.375rem" }} />
                </div>
                <div>
                  <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600 }}>End Time *</label>
                  <input type="datetime-local" required value={formData.end_time} onChange={(e) => setFormData({ ...formData, end_time: e.target.value })} style={{ width: "100%", padding: "0.75rem", border: "1px solid #A8E8BC", borderRadius: "0.375rem" }} />
                </div>
              </div>
              {examMode === "flexible" && (
                <div style={{ marginTop: "1rem" }}>
                  <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600 }}>Duration (minutes) *</label>
                  <input
                    type="number"
                    min={1}
                    value={timerMode === "PER_QUESTION" ? calculateTotalDuration() : formData.duration_minutes}
                    disabled={timerMode === "PER_QUESTION"}
                    onChange={(e) => {
                      const numValue = parseInt(e.target.value, 10);
                      if (!isNaN(numValue) && numValue >= 1) {
                        setFormData({ ...formData, duration_minutes: numValue });
                      }
                    }}
                    style={{ width: "200px", padding: "0.75rem", border: "1px solid #A8E8BC", borderRadius: "0.375rem", backgroundColor: timerMode === "PER_QUESTION" ? "#F3F4F6" : "#ffffff" }}
                  />
                </div>
              )}
            </div>

            {/* Timer Configuration (PER_QUESTION support) */}
            <div style={{ marginBottom: "1.5rem" }}>
              <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600 }}>Timer Configuration *</label>
              {formData.question_ids.length >= 2 && (
                <div style={{ marginBottom: "1rem", padding: "1rem", backgroundColor: "#F0FDF4", borderRadius: "0.375rem", border: "1px solid #A8E8BC" }}>
                  <div style={{ display: "flex", gap: "2rem" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                      <input type="radio" name="timerMode" value="GLOBAL" checked={timerMode === "GLOBAL"} onChange={() => setTimerMode("GLOBAL")} style={{ accentColor: "#2D7A52" }} />
                      <span>Single timer for entire test</span>
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                      <input type="radio" name="timerMode" value="PER_QUESTION" checked={timerMode === "PER_QUESTION"} onChange={() => setTimerMode("PER_QUESTION")} style={{ accentColor: "#2D7A52" }} />
                      <span>Individual timer per question</span>
                    </label>
                  </div>
                </div>
              )}

              {(timerMode === "GLOBAL" || formData.question_ids.length < 2) && examMode !== "flexible" && (
                <div>
                  <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500, fontSize: "0.875rem", color: "#374151" }}>Duration (minutes)</label>
                  <input type="number" required min="1" value={formData.duration_minutes} onChange={(e) => setFormData({ ...formData, duration_minutes: Math.max(1, parseInt(e.target.value || "1", 10)) })} style={{ width: "200px", padding: "0.75rem", border: "1px solid #A8E8BC", borderRadius: "0.375rem" }} />
                </div>
              )}

              {timerMode === "PER_QUESTION" && formData.question_ids.length >= 2 && (
                <div>
                  <p style={{ fontSize: "0.875rem", color: "#6B7280", marginBottom: "0.75rem" }}>Set duration for each question individually:</p>
                  <div style={{ border: "1px solid #A8E8BC", borderRadius: "0.375rem", padding: "1rem" }}>
                    {formData.question_ids.map((qid, index) => (
                      <div key={qid} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.75rem", marginBottom: index < formData.question_ids.length - 1 ? "0.5rem" : 0, backgroundColor: "#ffffff", borderRadius: "0.375rem", border: "1px solid #E8FAF0" }}>
                        <div style={{ flex: 1 }}>
                          <span style={{ fontWeight: 500, color: "#1a1625" }}>{index + 1}. {questions.find(q => q.id === qid)?.title || "Unknown Question"}</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          <input type="number" min="1" value={questionTimings[qid] || 10} onChange={(e) => updateQuestionTiming(qid, parseInt(e.target.value, 10) || 1)} style={{ width: "80px", padding: "0.5rem", border: "1px solid #A8E8BC", borderRadius: "0.375rem", textAlign: "center" }} />
                          <span style={{ fontSize: "0.875rem", color: "#6B7280" }}>min</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: "0.75rem", padding: "0.75rem", backgroundColor: "#E8FAF0", borderRadius: "0.375rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontWeight: 600, color: "#2D7A52" }}>Total Duration:</span>
                    <span style={{ fontWeight: 600, color: "#1a1625" }}>{calculateTotalDuration()} minutes</span>
                  </div>
                </div>
              )}
            </div>

            <div style={{ marginBottom: "1.5rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                <label style={{ fontWeight: 600 }}>Select Questions *</label>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => router.push("/aiml/questions/create")}
                  style={{ padding: "0.5rem 1rem", fontSize: "0.875rem" }}
                >
                  + Create Question
                </button>
              </div>

              {questions.length === 0 ? (
                <div style={{ padding: "2rem", border: "1px solid #A8E8BC", borderRadius: "0.375rem", textAlign: "center", color: "#2D7A52" }}>
                  <p>No questions available. Create a question using the button above.</p>
                </div>
              ) : (
                <>
                  <div style={{ border: "1px solid #A8E8BC", borderRadius: "0.375rem", padding: "1rem", maxHeight: "400px", overflowY: "auto" }}>
                    {questions.map((q) => (
                      <div
                        key={q.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.75rem",
                          padding: "0.75rem",
                          marginBottom: "0.5rem",
                          border: formData.question_ids.includes(q.id) ? "2px solid #2D7A52" : "1px solid #E8FAF0",
                          borderRadius: "0.375rem",
                          cursor: "pointer",
                          backgroundColor: formData.question_ids.includes(q.id) ? "#E8FAF0" : "#ffffff",
                        }}
                        onClick={() => toggleQuestion(q.id)}
                      >
                        <input
                          type="checkbox"
                          checked={formData.question_ids.includes(q.id)}
                          onChange={() => toggleQuestion(q.id)}
                        />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, color: "#1a1625" }}>{q.title}</div>
                          <div style={{ fontSize: "0.875rem", color: "#2D7A52", display: "flex", gap: "0.5rem", alignItems: "center" }}>
                            <span style={{ textTransform: "capitalize" }}>{q.difficulty}</span>
                            {q.library && <span>• {q.library}</span>}
                            {q.ai_generated && <span>• 🤖 AI</span>}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => handleDeleteQuestion(q.id, e)}
                          style={{
                            padding: "0.5rem",
                            border: "none",
                            backgroundColor: "transparent",
                            color: "#ef4444",
                            cursor: "pointer",
                            fontSize: "1.25rem",
                          }}
                        >
                          🗑️
                        </button>
                      </div>
                    ))}
                  </div>
                  <p style={{ fontSize: "0.875rem", color: "#2D7A52", marginTop: "0.5rem" }}>
                    Selected: {formData.question_ids.length} questions
                  </p>
                </>
              )}
            </div>

            <div style={{ display: "flex", gap: "1rem", marginTop: "2rem" }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => router.push("/dashboard")}
                style={{ flex: 1 }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={loading || formData.question_ids.length === 0}
                style={{ flex: 1 }}
              >
                {loading ? "Creating..." : "Create AIML Competency Test"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export const getServerSideProps: GetServerSideProps = requireAuth;

