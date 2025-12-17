import { useState, useEffect, useMemo } from "react";
import { CustomMCQAssessment, MCQQuestion, MCQOption } from "../../types/custom-mcq";

interface Station3Props {
  assessmentData: Partial<CustomMCQAssessment>;
  updateAssessmentData: (updates: Partial<CustomMCQAssessment>) => void;
}

export default function Station3ReviewEdit({ assessmentData, updateAssessmentData }: Station3Props) {
  const [editingQuestion, setEditingQuestion] = useState<MCQQuestion | null>(null);
  const [editingQuestionIndex, setEditingQuestionIndex] = useState<number | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newQuestion, setNewQuestion] = useState<Partial<MCQQuestion>>({
    section: "",
    question: "",
    options: [{ label: "A", text: "" }, { label: "B", text: "" }, { label: "C", text: "" }, { label: "D", text: "" }],
    correctAn: "",
    answerType: "single",
    marks: 1,
  });

  const questions = assessmentData.questions || [];
  
  // Ensure all questions have unique IDs - use useMemo to avoid recalculating unnecessarily
  const questionsWithIds = useMemo(() => {
    return questions.map((q, idx) => ({
      ...q,
      id: q.id || `q_${Date.now()}_${idx}_${Math.random().toString(36).substr(2, 9)}`,
    }));
  }, [questions]);
  
  // Update assessment data if IDs were missing (only once when component mounts or questions change)
  useEffect(() => {
    const needsUpdate = questions.some((q, idx) => !q.id);
    if (needsUpdate && questions.length > 0) {
      updateAssessmentData({ questions: questionsWithIds });
    }
  }, []); // Only run once on mount

  const addOption = (question: Partial<MCQQuestion>) => {
    const options = question.options || [];
    const nextLabel = String.fromCharCode(65 + options.length); // A, B, C, D, E, ...
    setNewQuestion({
      ...question,
      options: [...options, { label: nextLabel, text: "" }],
    });
  };

  const removeOption = (question: Partial<MCQQuestion>, index: number) => {
    const options = question.options || [];
    if (options.length > 2) {
      const newOptions = options.filter((_, i) => i !== index);
      setNewQuestion({
        ...question,
        options: newOptions,
      });
    }
  };

  const handleSaveQuestion = () => {
    if (!newQuestion.section || !newQuestion.question || !newQuestion.correctAn) {
      alert("Please fill in all required fields");
      return;
    }

    if (!newQuestion.options || newQuestion.options.length < 2) {
      alert("At least 2 options are required");
      return;
    }

    if (newQuestion.options.some(opt => !opt.text.trim())) {
      alert("All options must have text");
      return;
    }

    // Use current questions with IDs, not the original array
    const currentQuestions = questionsWithIds;
    
    const questionToSave: MCQQuestion = {
      id: editingQuestion?.id || `q_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      section: newQuestion.section!,
      question: newQuestion.question!,
      options: newQuestion.options!,
      correctAn: newQuestion.correctAn.toUpperCase(),
      answerType: newQuestion.answerType || "single",
      marks: newQuestion.marks || 1,
    };

    let updatedQuestions: MCQQuestion[];
    if (editingQuestion !== null && editingQuestionIndex !== null) {
      // Update by index to ensure we only update the exact question being edited
      updatedQuestions = currentQuestions.map((q, idx) => 
        idx === editingQuestionIndex ? questionToSave : q
      );
    } else {
      // Add new question
      updatedQuestions = [...currentQuestions, questionToSave];
    }

    updateAssessmentData({ questions: updatedQuestions });
    setEditingQuestion(null);
    setEditingQuestionIndex(null);
    setShowAddForm(false);
    setNewQuestion({
      section: "",
      question: "",
      options: [{ label: "A", text: "" }, { label: "B", text: "" }, { label: "C", text: "" }, { label: "D", text: "" }],
      correctAn: "",
      answerType: "single",
      marks: 1,
    });
  };

  const handleEdit = (question: MCQQuestion, index: number) => {
    // Use questions with IDs to get the correct question
    const questionToEdit = questionsWithIds[index];
    setEditingQuestion(questionToEdit);
    setEditingQuestionIndex(index);
    // Deep copy the question to avoid mutating the original
    setNewQuestion({ 
      ...questionToEdit,
      options: questionToEdit.options.map(opt => ({ ...opt }))
    });
    setShowAddForm(true);
  };

  const handleDelete = (questionId: string) => {
    if (confirm("Are you sure you want to delete this question?")) {
      const updatedQuestions = questionsWithIds.filter((q) => q.id !== questionId);
      updateAssessmentData({ questions: updatedQuestions });
    }
  };

  return (
    <div>
      <h2 style={{ marginBottom: "1.5rem", color: "#1E5A3B" }}>✏️ Review & Edit Questions</h2>
      <p style={{ marginBottom: "2rem", color: "#2D7A52" }}>
        Review, edit, or add questions. All questions from your CSV are shown below.
      </p>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <div>
          <strong style={{ color: "#1E5A3B" }}>Total Questions: {questionsWithIds.length}</strong>
        </div>
        <button
          type="button"
          onClick={() => {
            setShowAddForm(true);
            setEditingQuestion(null);
            setNewQuestion({
              section: "",
              question: "",
              options: [{ label: "A", text: "" }, { label: "B", text: "" }, { label: "C", text: "" }, { label: "D", text: "" }],
              correctAn: "",
              answerType: "single",
              marks: 1,
            });
          }}
          className="btn-primary"
        >
          + Add Question
        </button>
      </div>

      {/* Add/Edit Form */}
      {showAddForm && (
        <div
          style={{
            padding: "1.5rem",
            border: "2px solid #A8E8BC",
            borderRadius: "0.5rem",
            marginBottom: "2rem",
            backgroundColor: "#E8FAF0",
          }}
        >
          <h3 style={{ marginBottom: "1rem", color: "#1E5A3B" }}>
            {editingQuestion ? "Edit Question" : "Add New Question"}
          </h3>

          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div>
              <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1E5A3B" }}>
                Section <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <input
                type="text"
                value={newQuestion.section || ""}
                onChange={(e) => setNewQuestion({ ...newQuestion, section: e.target.value })}
                placeholder="e.g., aptitude, technical"
                style={{ width: "100%", padding: "0.5rem", border: "1px solid #A8E8BC", borderRadius: "0.25rem" }}
              />
            </div>

            <div>
              <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1E5A3B" }}>
                Question <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <textarea
                value={newQuestion.question || ""}
                onChange={(e) => setNewQuestion({ ...newQuestion, question: e.target.value })}
                placeholder="Enter your question"
                rows={3}
                style={{ width: "100%", padding: "0.5rem", border: "1px solid #A8E8BC", borderRadius: "0.25rem" }}
              />
            </div>

            <div>
              <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1E5A3B" }}>
                Answer Type <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <select
                value={newQuestion.answerType || "single"}
                onChange={(e) => setNewQuestion({ ...newQuestion, answerType: e.target.value as any })}
                style={{ width: "100%", padding: "0.5rem", border: "1px solid #A8E8BC", borderRadius: "0.25rem" }}
              >
                <option value="single">Single Choice</option>
                <option value="multiple_all">Multiple Choice (All Required)</option>
                <option value="multiple_any">Multiple Choice (Any One)</option>
              </select>
            </div>

            <div>
              <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1E5A3B" }}>
                Options <span style={{ color: "#ef4444" }}>*</span>
              </label>
              {(newQuestion.options || []).map((option, idx) => (
                <div key={idx} style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
                  <input
                    type="text"
                    value={option.label}
                    disabled
                    style={{ width: "50px", padding: "0.5rem", border: "1px solid #A8E8BC", borderRadius: "0.25rem", backgroundColor: "#f0f0f0" }}
                  />
                  <input
                    type="text"
                    value={option.text}
                    onChange={(e) => {
                      const newOptions = [...(newQuestion.options || [])];
                      newOptions[idx].text = e.target.value;
                      setNewQuestion({ ...newQuestion, options: newOptions });
                    }}
                    placeholder={`Option ${option.label}`}
                    style={{ flex: 1, padding: "0.5rem", border: "1px solid #A8E8BC", borderRadius: "0.25rem" }}
                  />
                  {(newQuestion.options || []).length > 2 && (
                    <button
                      type="button"
                      onClick={() => removeOption(newQuestion, idx)}
                      style={{ padding: "0.5rem 1rem", backgroundColor: "#ef4444", color: "#fff", border: "none", borderRadius: "0.25rem", cursor: "pointer" }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={() => addOption(newQuestion)}
                className="btn-secondary"
                style={{ width: "fit-content" }}
              >
                + Add Option
              </button>
            </div>

            <div>
              <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1E5A3B" }}>
                Correct Answer(s) <span style={{ color: "#ef4444" }}>*</span>
                <span style={{ fontSize: "0.875rem", fontWeight: 400, color: "#2D7A52" }}>
                  {" "}(e.g., A or A,B for multiple)
                </span>
              </label>
              <input
                type="text"
                value={newQuestion.correctAn || ""}
                onChange={(e) => setNewQuestion({ ...newQuestion, correctAn: e.target.value.toUpperCase() })}
                placeholder="A or A,B"
                style={{ width: "100%", padding: "0.5rem", border: "1px solid #A8E8BC", borderRadius: "0.25rem" }}
              />
            </div>

            <div>
              <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1E5A3B" }}>
                Marks <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <input
                type="number"
                value={newQuestion.marks || 1}
                onChange={(e) => setNewQuestion({ ...newQuestion, marks: parseInt(e.target.value) || 1 })}
                min={1}
                style={{ width: "100%", padding: "0.5rem", border: "1px solid #A8E8BC", borderRadius: "0.25rem" }}
              />
            </div>

            <div style={{ display: "flex", gap: "1rem" }}>
              <button type="button" onClick={handleSaveQuestion} className="btn-primary">
                {editingQuestion ? "Save Changes" : "Add Question"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddForm(false);
                  setEditingQuestion(null);
                }}
                className="btn-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Questions List */}
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {questionsWithIds.map((question, idx) => (
          <div
            key={question.id || idx}
            style={{
              padding: "1.5rem",
              border: "1px solid #A8E8BC",
              borderRadius: "0.5rem",
              backgroundColor: "#ffffff",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "1rem" }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", gap: "1rem", marginBottom: "0.5rem" }}>
                  <span style={{ fontWeight: 600, color: "#2D7A52" }}>Q{idx + 1}</span>
                  <span style={{ color: "#4A9A6A" }}>[{question.section}]</span>
                  <span style={{ color: "#4A9A6A" }}>{question.answerType}</span>
                  <span style={{ color: "#4A9A6A" }}>{question.marks} marks</span>
                </div>
                <p style={{ marginBottom: "1rem", fontWeight: 600, color: "#1E5A3B" }}>{question.question}</p>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {question.options.map((opt, optIdx) => (
                    <div key={optIdx} style={{ paddingLeft: "1rem", color: "#2D7A52" }}>
                      <strong>{opt.label}:</strong> {opt.text}
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: "0.5rem", color: "#10b981", fontWeight: 600 }}>
                  Correct: {question.correctAn}
                </div>
              </div>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  type="button"
                  onClick={() => handleEdit(question, idx)}
                  className="btn-secondary"
                  style={{ padding: "0.5rem 1rem", fontSize: "0.875rem" }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(question.id)}
                  style={{
                    padding: "0.5rem 1rem",
                    fontSize: "0.875rem",
                    backgroundColor: "#ef4444",
                    color: "#fff",
                    border: "none",
                    borderRadius: "0.25rem",
                    cursor: "pointer",
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
        {questionsWithIds.length === 0 && (
          <div style={{ textAlign: "center", padding: "3rem", color: "#4A9A6A" }}>
            No questions yet. Add questions or upload a CSV file.
          </div>
        )}
      </div>
    </div>
  );
}

