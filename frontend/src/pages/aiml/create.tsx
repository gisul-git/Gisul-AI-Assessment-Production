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
    setLoading(true);

    try {
      // Create the test
      const response = await aimlApi.post("/tests/", {
        ...formData,
        start_time: new Date(formData.start_time).toISOString(),
        end_time: new Date(formData.end_time).toISOString(),
      });
      
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
    } else {
      setFormData({
        ...formData,
        question_ids: [...formData.question_ids, questionId],
      });
    }
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

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem", marginBottom: "1.5rem" }}>
              <div>
                <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600 }}>
                  Duration (minutes) *
                </label>
                <input
                  type="number"
                  required
                  min="1"
                  value={formData.duration_minutes}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === '') {
                      setFormData({ ...formData, duration_minutes: 0 });
                      return;
                    }
                    const numValue = parseInt(value, 10);
                    if (!isNaN(numValue) && numValue >= 0) {
                      setFormData({ ...formData, duration_minutes: numValue });
                    }
                  }}
                  onBlur={(e) => {
                    if (formData.duration_minutes < 1) {
                      setFormData({ ...formData, duration_minutes: 1 });
                    }
                  }}
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    border: "1px solid #A8E8BC",
                    borderRadius: "0.375rem",
                  }}
                />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600 }}>
                  Start Time *
                </label>
                <input
                  type="datetime-local"
                  required
                  value={formData.start_time}
                  onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    border: "1px solid #A8E8BC",
                    borderRadius: "0.375rem",
                  }}
                />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600 }}>
                  End Time *
                </label>
                <input
                  type="datetime-local"
                  required
                  value={formData.end_time}
                  onChange={(e) => setFormData({ ...formData, end_time: e.target.value })}
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    border: "1px solid #A8E8BC",
                    borderRadius: "0.375rem",
                  }}
                />
              </div>
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

