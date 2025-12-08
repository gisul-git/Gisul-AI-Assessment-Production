import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import { GetServerSideProps } from "next";
import { requireAuth } from "../../lib/auth";
import Link from "next/link";
import axios from "axios";

// ============================================
// QUESTION RENDERING COMPONENTS
// ============================================

const renderMCQQuestion = (question: any, isEditing: boolean, onEditChange?: (value: string) => void) => {
  // Handle both 'question' and 'questionText' field names for backward compatibility
  const questionText = question.question || question.questionText || "";
  
  if (isEditing && onEditChange) {
    return (
      <div>
        <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
          Question:
        </label>
        <textarea
          value={questionText}
          onChange={(e) => onEditChange(JSON.stringify({ ...question, question: e.target.value, questionText: e.target.value }, null, 2))}
          style={{
            width: "100%",
            minHeight: "80px",
            padding: "0.75rem",
            border: "1px solid #e2e8f0",
            borderRadius: "0.5rem",
            fontSize: "0.875rem",
            marginBottom: "1rem",
          }}
        />
        <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
          Options:
        </label>
        {(question.options || []).map((option: string, idx: number) => (
          <div key={idx} style={{ marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontWeight: 600, color: "#64748b", minWidth: "24px" }}>{String.fromCharCode(65 + idx)}.</span>
            <input
              type="text"
              value={option}
              onChange={(e) => {
                const newOptions = [...(question.options || [])];
                newOptions[idx] = e.target.value;
                onEditChange(JSON.stringify({ ...question, options: newOptions }, null, 2));
              }}
              style={{
                flex: 1,
                padding: "0.5rem",
                border: "1px solid #e2e8f0",
                borderRadius: "0.375rem",
                fontSize: "0.875rem",
              }}
            />
          </div>
        ))}
        <label style={{ display: "block", marginTop: "1rem", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
          Correct Answer:
        </label>
        <input
          type="text"
          value={question.correctAnswer || ""}
          onChange={(e) => onEditChange(JSON.stringify({ ...question, correctAnswer: e.target.value }, null, 2))}
          style={{
            width: "100%",
            padding: "0.5rem",
            border: "1px solid #e2e8f0",
            borderRadius: "0.375rem",
            fontSize: "0.875rem",
          }}
        />
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: "1.5rem" }}>
        <h3 style={{ fontSize: "1.125rem", fontWeight: 600, color: "#1e293b", marginBottom: "1rem" }}>
          {question.question || "Question"}
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {(question.options || []).map((option: string, idx: number) => {
            const isCorrect = option === question.correctAnswer;
            return (
              <div
                key={idx}
                style={{
                  padding: "0.75rem 1rem",
                  border: `2px solid ${isCorrect ? "#10b981" : "#e2e8f0"}`,
                  borderRadius: "0.5rem",
                  backgroundColor: isCorrect ? "#d1fae5" : "#ffffff",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                }}
              >
                <span style={{
                  fontWeight: 700,
                  color: isCorrect ? "#065f46" : "#64748b",
                  minWidth: "32px",
                  fontSize: "0.875rem",
                }}>
                  {String.fromCharCode(65 + idx)}.
                </span>
                <span style={{ flex: 1, color: "#1e293b" }}>{option}</span>
                {isCorrect && (
                  <span style={{
                    padding: "0.25rem 0.75rem",
                    backgroundColor: "#10b981",
                    color: "#ffffff",
                    borderRadius: "0.375rem",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                  }}>
                    Correct
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const renderSubjectiveQuestion = (question: any, isEditing: boolean, onEditChange?: (value: string) => void) => {
  // Handle both 'question' and 'questionText' field names for backward compatibility
  const questionText = question.question || question.questionText || "";
  
  if (isEditing && onEditChange) {
    return (
      <div>
        <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
          Question:
        </label>
        <textarea
          value={questionText}
          onChange={(e) => onEditChange(JSON.stringify({ ...question, question: e.target.value, questionText: e.target.value }, null, 2))}
          style={{
            width: "100%",
            minHeight: "150px",
            padding: "0.75rem",
            border: "1px solid #e2e8f0",
            borderRadius: "0.5rem",
            fontSize: "0.875rem",
          }}
          placeholder="Enter your subjective question (scenario-based or conceptual)..."
        />
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: "1.5rem" }}>
        {questionText ? (
          <div style={{
            padding: "1.25rem",
            backgroundColor: "#ffffff",
            borderRadius: "0.5rem",
            border: "1px solid #e2e8f0",
            boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)",
          }}>
            <div style={{ fontSize: "1rem", color: "#1e293b", whiteSpace: "pre-wrap", lineHeight: "1.6" }}>
              {questionText}
            </div>
          </div>
        ) : (
          <div style={{ padding: "1rem", backgroundColor: "#fef3c7", borderRadius: "0.5rem", color: "#92400e" }}>
            No question text available. Please regenerate this question.
          </div>
        )}
      </div>
    </div>
  );
};

const renderPseudoCodeQuestion = (question: any, isEditing: boolean, onEditChange?: (value: string) => void) => {
  // Handle both 'question' and 'questionText' field names for backward compatibility
  // Also handle 'expectedLogic' (old) and 'expectedAnswer' (new) field names
  const questionText = question.question || question.questionText || "";
  const expectedAnswer = question.expectedAnswer || question.expectedLogic || "";
  const explanation = question.explanation || "";
  
  if (isEditing && onEditChange) {
    return (
      <div>
        <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
          Question:
        </label>
        <textarea
          value={questionText}
          onChange={(e) => onEditChange(JSON.stringify({ ...question, question: e.target.value, questionText: e.target.value }, null, 2))}
          style={{
            width: "100%",
            minHeight: "100px",
            padding: "0.75rem",
            border: "1px solid #e2e8f0",
            borderRadius: "0.5rem",
            fontSize: "0.875rem",
            marginBottom: "1rem",
          }}
        />
        <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
          Expected Answer (Pseudocode):
        </label>
        <textarea
          value={expectedAnswer}
          onChange={(e) => onEditChange(JSON.stringify({ ...question, expectedAnswer: e.target.value, expectedLogic: e.target.value }, null, 2))}
          style={{
            width: "100%",
            minHeight: "200px",
            padding: "0.75rem",
            border: "1px solid #e2e8f0",
            borderRadius: "0.5rem",
            fontSize: "0.875rem",
            fontFamily: "monospace",
            marginBottom: "1rem",
          }}
        />
        {explanation && (
          <>
            <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
              Explanation:
            </label>
            <textarea
              value={explanation}
              onChange={(e) => onEditChange(JSON.stringify({ ...question, explanation: e.target.value }, null, 2))}
              style={{
                width: "100%",
                minHeight: "100px",
                padding: "0.75rem",
                border: "1px solid #e2e8f0",
                borderRadius: "0.5rem",
                fontSize: "0.875rem",
              }}
            />
          </>
        )}
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: "1.5rem" }}>
        {questionText ? (
          <h3 style={{ fontSize: "1.125rem", fontWeight: 600, color: "#1e293b", marginBottom: "1rem" }}>
            {questionText}
          </h3>
        ) : (
          <div style={{ padding: "1rem", backgroundColor: "#fef3c7", borderRadius: "0.5rem", color: "#92400e" }}>
            No question text available. Please regenerate this question.
          </div>
        )}
        {expectedAnswer && (
          <div style={{ marginTop: "1rem" }}>
            <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "#64748b", marginBottom: "0.5rem" }}>
              Expected Answer (Pseudocode):
            </div>
            <div style={{
              padding: "1rem",
              backgroundColor: "#1e293b",
              color: "#f1f5f9",
              borderRadius: "0.5rem",
              fontFamily: "monospace",
              fontSize: "0.875rem",
              whiteSpace: "pre-wrap",
              overflowX: "auto",
            }}>
              {expectedAnswer}
            </div>
          </div>
        )}
        {explanation && (
          <div style={{ marginTop: "1rem" }}>
            <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "#64748b", marginBottom: "0.5rem" }}>
              Explanation:
            </div>
            <div style={{
              padding: "1rem",
              backgroundColor: "#f8fafc",
              borderRadius: "0.5rem",
              fontSize: "0.875rem",
              color: "#1e293b",
              lineHeight: "1.6",
            }}>
              {explanation}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const renderCodingQuestion = (question: any, isEditing: boolean, onEditChange?: (value: string) => void) => {
  // Support both old format (title, problemStatement, etc.) and new DSA format (questionText, starterCode, etc.)
  const questionText = question.questionText || (question.title ? `${question.title}\n\n${question.problemStatement || ""}` : question.problemStatement || "");
  const starterCode = question.starterCode || "";
  const visibleTestCases = question.visibleTestCases || (question.visibleTestCases ? [] : []);
  const hiddenTestCases = question.hiddenTestCases || [];
  const constraints = question.constraints || "";
  const functionSignature = question.functionSignature || "";
  const explanation = question.explanation || "";
  
  if (isEditing && onEditChange) {
    return (
      <div>
        <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
          Title:
        </label>
        <input
          type="text"
          value={question.title || ""}
          onChange={(e) => onEditChange(JSON.stringify({ ...question, title: e.target.value }, null, 2))}
          style={{
            width: "100%",
            padding: "0.5rem",
            border: "1px solid #e2e8f0",
            borderRadius: "0.375rem",
            fontSize: "0.875rem",
            marginBottom: "1rem",
          }}
        />
        <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
          Problem Statement:
        </label>
        <textarea
          value={question.problemStatement || ""}
          onChange={(e) => onEditChange(JSON.stringify({ ...question, problemStatement: e.target.value }, null, 2))}
          style={{
            width: "100%",
            minHeight: "100px",
            padding: "0.75rem",
            border: "1px solid #e2e8f0",
            borderRadius: "0.5rem",
            fontSize: "0.875rem",
            marginBottom: "1rem",
          }}
        />
        <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
          Function Signature:
        </label>
        <textarea
          value={question.functionSignature || ""}
          onChange={(e) => onEditChange(JSON.stringify({ ...question, functionSignature: e.target.value }, null, 2))}
          style={{
            width: "100%",
            minHeight: "60px",
            padding: "0.75rem",
            border: "1px solid #e2e8f0",
            borderRadius: "0.5rem",
            fontSize: "0.875rem",
            fontFamily: "monospace",
            marginBottom: "1rem",
          }}
        />
        <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
          Input Format:
        </label>
        <textarea
          value={question.inputFormat || ""}
          onChange={(e) => onEditChange(JSON.stringify({ ...question, inputFormat: e.target.value }, null, 2))}
          style={{
            width: "100%",
            minHeight: "60px",
            padding: "0.75rem",
            border: "1px solid #e2e8f0",
            borderRadius: "0.5rem",
            fontSize: "0.875rem",
            marginBottom: "1rem",
          }}
        />
        <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
          Output Format:
        </label>
        <textarea
          value={question.outputFormat || ""}
          onChange={(e) => onEditChange(JSON.stringify({ ...question, outputFormat: e.target.value }, null, 2))}
          style={{
            width: "100%",
            minHeight: "60px",
            padding: "0.75rem",
            border: "1px solid #e2e8f0",
            borderRadius: "0.5rem",
            fontSize: "0.875rem",
            marginBottom: "1rem",
          }}
        />
        <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
          Constraints:
        </label>
        <textarea
          value={question.constraints || ""}
          onChange={(e) => onEditChange(JSON.stringify({ ...question, constraints: e.target.value }, null, 2))}
          style={{
            width: "100%",
            minHeight: "80px",
            padding: "0.75rem",
            border: "1px solid #e2e8f0",
            borderRadius: "0.5rem",
            fontSize: "0.875rem",
            marginBottom: "1rem",
          }}
        />
        <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
          Sample Input:
        </label>
        <textarea
          value={question.sampleInput || ""}
          onChange={(e) => onEditChange(JSON.stringify({ ...question, sampleInput: e.target.value }, null, 2))}
          style={{
            width: "100%",
            minHeight: "60px",
            padding: "0.75rem",
            border: "1px solid #e2e8f0",
            borderRadius: "0.5rem",
            fontSize: "0.875rem",
            fontFamily: "monospace",
            marginBottom: "1rem",
          }}
        />
        <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
          Sample Output:
        </label>
        <textarea
          value={question.sampleOutput || ""}
          onChange={(e) => onEditChange(JSON.stringify({ ...question, sampleOutput: e.target.value }, null, 2))}
          style={{
            width: "100%",
            minHeight: "60px",
            padding: "0.75rem",
            border: "1px solid #e2e8f0",
            borderRadius: "0.5rem",
            fontSize: "0.875rem",
            fontFamily: "monospace",
            marginBottom: "1rem",
          }}
        />
      </div>
    );
  }

  return (
    <div>
      {/* Question Text (Description + Examples) */}
      {questionText && (
        <div style={{ marginBottom: "1.5rem" }}>
          <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "#64748b", marginBottom: "0.5rem" }}>
            Problem Description:
          </div>
          <div style={{ 
            color: "#1e293b", 
            whiteSpace: "pre-wrap", 
            lineHeight: "1.6",
            padding: "1rem",
            backgroundColor: "#f8fafc",
            borderRadius: "0.5rem",
            border: "1px solid #e2e8f0",
          }}>
            {questionText}
          </div>
        </div>
      )}
      
      {/* Starter Code (Readonly) */}
      {starterCode && (
        <div style={{ marginBottom: "1.5rem" }}>
          <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "#64748b", marginBottom: "0.5rem" }}>
            Starter Code (Readonly):
          </div>
          <div style={{
            padding: "1rem",
            backgroundColor: "#1e293b",
            color: "#f1f5f9",
            borderRadius: "0.5rem",
            fontFamily: "monospace",
            fontSize: "0.875rem",
            whiteSpace: "pre-wrap",
            border: "2px solid #3b82f6",
            position: "relative",
          }}>
            <div style={{
              position: "absolute",
              top: "0.5rem",
              right: "0.5rem",
              fontSize: "0.75rem",
              color: "#94a3b8",
              backgroundColor: "#1e293b",
              padding: "0.25rem 0.5rem",
              borderRadius: "0.25rem",
            }}>
              Readonly
            </div>
            {starterCode}
          </div>
          <p style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "0.5rem", fontStyle: "italic" }}>
            This starter code cannot be modified. Only the editable region can be changed.
          </p>
        </div>
      )}
      
      {/* Function Signature */}
      {functionSignature && (
        <div style={{ marginBottom: "1.5rem" }}>
          <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "#64748b", marginBottom: "0.5rem" }}>
            Function Signature:
          </div>
          <div style={{
            padding: "0.75rem",
            backgroundColor: "#1e293b",
            color: "#f1f5f9",
            borderRadius: "0.5rem",
            fontFamily: "monospace",
            fontSize: "0.875rem",
            whiteSpace: "pre-wrap",
          }}>
            {typeof functionSignature === 'object' 
              ? `${functionSignature.name || 'function'}(${functionSignature.parameters?.map((p: any) => `${p.name}: ${p.type}`).join(', ') || ''}): ${functionSignature.return_type || ''}`
              : functionSignature}
          </div>
        </div>
      )}
      
      {/* Legacy support for old format */}
      {!questionText && question.title && (
        <div style={{ marginBottom: "1.5rem" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 700, color: "#1e293b", marginBottom: "1rem" }}>
            {question.title}
          </h2>
        </div>
      )}
      {!questionText && question.problemStatement && (
        <div style={{ marginBottom: "1.5rem" }}>
          <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "#64748b", marginBottom: "0.5rem" }}>
            Problem Statement:
          </div>
          <div style={{ color: "#1e293b", whiteSpace: "pre-wrap", lineHeight: "1.6" }}>
            {question.problemStatement}
          </div>
        </div>
      )}
      {/* Constraints */}
      {constraints && (
        <div style={{ marginBottom: "1.5rem" }}>
          <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "#64748b", marginBottom: "0.5rem" }}>
            Constraints:
          </div>
          <div style={{
            padding: "1rem",
            backgroundColor: "#fef3c7",
            borderRadius: "0.5rem",
            border: "1px solid #fbbf24",
          }}>
            {typeof constraints === 'string' && constraints.includes('\n') ? (
              <ul style={{
                paddingLeft: "1.5rem",
                color: "#1e293b",
                lineHeight: "1.8",
                margin: 0,
              }}>
                {constraints.split('\n').filter((c: string) => c.trim()).map((constraint: string, idx: number) => (
                  <li key={idx} style={{ marginBottom: "0.25rem" }}>{constraint.trim()}</li>
                ))}
              </ul>
            ) : (
              <div style={{ color: "#1e293b", whiteSpace: "pre-wrap" }}>
                {constraints}
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* Visible Test Cases */}
      {visibleTestCases && Array.isArray(visibleTestCases) && visibleTestCases.length > 0 && (
        <div style={{ marginBottom: "1.5rem" }}>
          <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "#64748b", marginBottom: "0.75rem" }}>
            Visible Test Cases ({visibleTestCases.length}):
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {visibleTestCases.map((testCase: any, idx: number) => (
              <div key={idx} style={{
                padding: "1rem",
                backgroundColor: "#f8fafc",
                borderRadius: "0.5rem",
                border: "1px solid #e2e8f0",
              }}>
                <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#64748b", marginBottom: "0.5rem" }}>
                  Test Case {idx + 1}:
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                  <div>
                    <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#64748b", marginBottom: "0.25rem" }}>
                      Input:
                    </div>
                    <div style={{
                      padding: "0.75rem",
                      backgroundColor: "#1e293b",
                      color: "#f1f5f9",
                      borderRadius: "0.375rem",
                      fontFamily: "monospace",
                      fontSize: "0.875rem",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                    }}>
                      {testCase.input || ""}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#64748b", marginBottom: "0.25rem" }}>
                      Expected Output:
                    </div>
                    <div style={{
                      padding: "0.75rem",
                      backgroundColor: "#10b981",
                      color: "#ffffff",
                      borderRadius: "0.375rem",
                      fontFamily: "monospace",
                      fontSize: "0.875rem",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                    }}>
                      {testCase.output || testCase.expected_output || ""}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "0.5rem", fontStyle: "italic" }}>
            These test cases are visible to candidates. Hidden test cases ({hiddenTestCases.length || 0}) are used for evaluation only.
          </p>
        </div>
      )}
      
      {/* Legacy support for old format test cases */}
      {(!visibleTestCases || visibleTestCases.length === 0) && question.sampleInput && question.sampleOutput && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1.5rem" }}>
          <div>
            <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "#64748b", marginBottom: "0.5rem" }}>
              Sample Input:
            </div>
            <div style={{
              padding: "0.75rem",
              backgroundColor: "#1e293b",
              color: "#f1f5f9",
              borderRadius: "0.5rem",
              fontFamily: "monospace",
              fontSize: "0.875rem",
              whiteSpace: "pre-wrap",
            }}>
              {question.sampleInput}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "#64748b", marginBottom: "0.5rem" }}>
              Sample Output:
            </div>
            <div style={{
              padding: "0.75rem",
              backgroundColor: "#1e293b",
              color: "#f1f5f9",
              borderRadius: "0.5rem",
              fontFamily: "monospace",
              fontSize: "0.875rem",
              whiteSpace: "pre-wrap",
            }}>
              {question.sampleOutput}
            </div>
          </div>
        </div>
      )}
      
      {/* Legacy support for old format input/output format */}
      {question.inputFormat && question.outputFormat && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1.5rem" }}>
          <div>
            <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "#64748b", marginBottom: "0.5rem" }}>
              Input Format:
            </div>
            <div style={{
              padding: "0.75rem",
              backgroundColor: "#f8fafc",
              borderRadius: "0.5rem",
              border: "1px solid #e2e8f0",
              fontSize: "0.875rem",
              whiteSpace: "pre-wrap",
            }}>
              {question.inputFormat}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "#64748b", marginBottom: "0.5rem" }}>
              Output Format:
            </div>
            <div style={{
              padding: "0.75rem",
              backgroundColor: "#f8fafc",
              borderRadius: "0.5rem",
              border: "1px solid #e2e8f0",
              fontSize: "0.875rem",
              whiteSpace: "pre-wrap",
            }}>
              {question.outputFormat}
            </div>
          </div>
        </div>
      )}
      
      {/* Explanation */}
      {explanation && (
        <div style={{ marginBottom: "1.5rem" }}>
          <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "#64748b", marginBottom: "0.5rem" }}>
            Explanation:
          </div>
          <div style={{ 
            color: "#1e293b", 
            whiteSpace: "pre-wrap", 
            lineHeight: "1.6",
            padding: "0.75rem",
            backgroundColor: "#f0f9ff",
            borderRadius: "0.5rem",
            border: "1px solid #bae6fd",
          }}>
            {explanation}
          </div>
        </div>
      )}
    </div>
  );
};

const renderQuestionByType = (question: any, questionType: string, isEditing: boolean, onEditChange?: (value: string) => void) => {
  switch (questionType) {
    case "MCQ":
      return renderMCQQuestion(question, isEditing, onEditChange);
    case "Subjective":
      return renderSubjectiveQuestion(question, isEditing, onEditChange);
    case "PseudoCode":
      return renderPseudoCodeQuestion(question, isEditing, onEditChange);
    case "Coding":
      return renderCodingQuestion(question, isEditing, onEditChange);
    default:
      return (
        <div style={{ padding: "1rem", backgroundColor: "#fef3c7", borderRadius: "0.5rem", color: "#92400e" }}>
          Unknown question type: {questionType}
        </div>
      );
  }
};

const QUESTION_TYPES = ["MCQ", "Subjective", "Pseudo Code", "Descriptive", "coding"];
const DIFFICULTY_LEVELS = ["Easy", "Medium", "Hard"];

// Helper function to get student level from slider value
function getStudentLevel(value: number): string {
  if (value < 1.5) return "Beginner";
  if (value < 3) return "Intermediate";
  return "Advanced";
}

// Helper function to truncate text to ~80 words
function truncateText(text: string, maxWords: number = 80): { truncated: string; isTruncated: boolean } {
  if (!text) return { truncated: "", isTruncated: false };
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) {
    return { truncated: text, isTruncated: false };
  }
  const truncated = words.slice(0, maxWords).join(" ") + "...";
  return { truncated, isTruncated: true };
}

// Helper function to extract question text for display
function getQuestionText(question: any, questionType: string): string {
  switch (questionType) {
    case "MCQ":
      return question.question || question.questionText || "";
    case "Subjective":
      return question.question || question.questionText || "";
    case "PseudoCode":
      return question.question || question.questionText || "";
    case "Coding":
      return question.problemStatement || question.title || "";
    default:
      return JSON.stringify(question);
  }
}

// Helper function to calculate base time per question type (in seconds)
function getBaseTimePerQuestion(questionType: string): number {
  switch (questionType) {
    case "MCQ":
      return 60; // 45-75 seconds, using 60 as average
    case "Subjective":
      return 150; // 120-180 seconds, using 150 as average
    case "PseudoCode":
      return 210; // 180-240 seconds, using 210 as average
    case "Coding":
      return 450; // 300-600 seconds, using 450 as average
    default:
      return 60;
  }
}

// Helper function to get difficulty multiplier
function getDifficultyMultiplier(difficulty: string): number {
  switch (difficulty) {
    case "Easy":
      return 1.0;
    case "Medium":
      return 1.5;
    case "Hard":
      return 2.0;
    default:
      return 1.0;
  }
}

// Helper function to get default score suggestion based on question type and difficulty
function getDefaultScore(questionType: string, difficulty: string): number {
  // Base scores per type
  const baseScores: { [key: string]: { Easy: number; Medium: number; Hard: number } } = {
    MCQ: { Easy: 1, Medium: 2, Hard: 3 },
    Subjective: { Easy: 4, Medium: 6, Hard: 8 },
    PseudoCode: { Easy: 6, Medium: 8, Hard: 10 },
    Coding: { Easy: 10, Medium: 15, Hard: 20 },
  };
  
  const typeScores = baseScores[questionType] || { Easy: 1, Medium: 2, Hard: 3 };
  return typeScores[difficulty as "Easy" | "Medium" | "Hard"] || typeScores.Easy;
}

// Helper function to calculate section timer (in seconds, convert to minutes for display)
function calculateSectionTimer(
  questions: Array<{ questionType: string; difficulty: string }>
): number {
  let totalSeconds = 0;
  questions.forEach((q) => {
    const baseTime = getBaseTimePerQuestion(q.questionType);
    const multiplier = getDifficultyMultiplier(q.difficulty);
    totalSeconds += baseTime * multiplier;
  });
  // Convert to minutes and round up
  return Math.ceil(totalSeconds / 60);
}

// Helper function to format time in minutes to readable format
function formatTime(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} minute${minutes !== 1 ? "s" : ""}`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) {
    return `${hours} hour${hours !== 1 ? "s" : ""}`;
  }
  return `${hours} hour${hours !== 1 ? "s" : ""} ${mins} minute${mins !== 1 ? "s" : ""}`;
}

interface QuestionTypeConfig {
  questionType: string;
  difficulty: string;
  numQuestions: number;
  language?: string; // Selected language ID
  judge0_enabled?: boolean; // Whether Judge0 is enabled
}

interface Topic {
  topic: string;
  questionTypeConfigs: QuestionTypeConfig[]; // Multiple question types per topic
  // For aptitude topics
  isAptitude?: boolean;
  subTopic?: string; // Selected sub-topic (e.g., "Number Systems")
  aptitudeStructure?: {
    subTopics: {
      [key: string]: string[]; // Sub-topic name -> question types
    };
  };
  availableSubTopics?: string[]; // List of available sub-topics for this main topic
  coding_supported?: boolean; // Whether this topic supports coding questions
}

export default function CreateNewAssessmentPage() {
  const router = useRouter();
  const { id } = router.query; // Get assessment ID from URL query params if editing
  const isEditMode = !!(id && typeof id === 'string'); // True if we have an ID (editing draft)
  
  const [currentStation, setCurrentStation] = useState(1);
  const [jobDesignation, setJobDesignation] = useState("");
  const [topicCards, setTopicCards] = useState<string[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [manualSkillInput, setManualSkillInput] = useState("");
  const [loadingCards, setLoadingCards] = useState(false);
  const [topics, setTopics] = useState<string[]>([]);
  const [experienceMin, setExperienceMin] = useState(0);
  const [experienceMax, setExperienceMax] = useState(10);
  const [experienceMode, setExperienceMode] = useState<"corporate" | "student">("corporate");
  const [availableQuestionTypes, setAvailableQuestionTypes] = useState<string[]>(QUESTION_TYPES);
  const [topicConfigs, setTopicConfigs] = useState<Topic[]>([]);
  const [questions, setQuestions] = useState<any[]>([]);
  const [assessmentId, setAssessmentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingDraft, setLoadingDraft] = useState(false); // Loading existing draft data
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finalTitle, setFinalTitle] = useState("");
  const [finalDescription, setFinalDescription] = useState("");
  const [passPercentage, setPassPercentage] = useState<number>(60); // Default 60%
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [candidates, setCandidates] = useState<Array<{ email: string; name: string; invited?: boolean; inviteSentAt?: string; status?: string }>>([]);
  const [candidateEmail, setCandidateEmail] = useState("");
  const [candidateName, setCandidateName] = useState("");
  const [assessmentUrl, setAssessmentUrl] = useState<string | null>(null);
  const [accessMode, setAccessMode] = useState<"public" | "private">("private");
  const [emailValidationError, setEmailValidationError] = useState<string | null>(null);
  const [invitationTemplate, setInvitationTemplate] = useState({
    logoUrl: "",
    companyName: "",
    message: "You have been invited to take an assessment. Please click the link below to start.",
    footer: "",
    sentBy: "AI Assessment Platform"
  });
  const [showEmailTemplate, setShowEmailTemplate] = useState(false);
  const [questionTypeTimes, setQuestionTypeTimes] = useState<{ [key: string]: number }>({});
  const [enablePerSectionTimers, setEnablePerSectionTimers] = useState<boolean>(true); // Default to enabled
  const [hasVisitedConfigureStation, setHasVisitedConfigureStation] = useState(false);
  const [hasVisitedReviewStation, setHasVisitedReviewStation] = useState(false);
  // Edit mode is always enabled - removed isConfigureEditMode state
  const [previewGenerating, setPreviewGenerating] = useState(false);
  const [previewQuestions, setPreviewQuestions] = useState<any[]>([]);
  const [previewProgress, setPreviewProgress] = useState({ current: 0, total: 0 });
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [currentPreviewIndex, setCurrentPreviewIndex] = useState(0);
  const [editingQuestionIndex, setEditingQuestionIndex] = useState<number | null>(null);
  const [editingQuestion, setEditingQuestion] = useState<any>(null);
  const [regeneratingQuestionIndex, setRegeneratingQuestionIndex] = useState<number | null>(null);
  const [customTopicInput, setCustomTopicInput] = useState("");
  const [regeneratingTopicIndex, setRegeneratingTopicIndex] = useState<number | null>(null);
  const [uploadingCsv, setUploadingCsv] = useState(false);
  const [initialLoadDone, setInitialLoadDone] = useState(false); // Prevent auto-save from overwriting during initial load
  
  // ============================================
  // NEW MULTI-ROW TOPIC V2 STATE (STRICT MODEL)
  // ============================================
  interface QuestionRow {
    rowId: string;
    questionType: "MCQ" | "Subjective" | "PseudoCode" | "Coding";
    difficulty: "Easy" | "Medium" | "Hard";
    questionsCount: number;
    canUseJudge0: boolean;
    status: "pending" | "generated" | "completed";
    locked: boolean;
    questions: any[];
  }

  interface TopicV2 {
    allowedQuestionTypes?: string[]; // Optional: For soft skills (aptitude, communication, logical_reasoning)
    id: string;
    label: string;
    locked: boolean;
    questionRows: QuestionRow[];
    category?: "aptitude" | "communication" | "logical_reasoning" | "technical";
    contextSummary?: string;
    suggestedQuestionType?: "MCQ" | "Subjective";
    coding_supported?: boolean; // Whether this topic supports coding questions
  }

  const [topicsV2, setTopicsV2] = useState<TopicV2[]>([]);
  const [fullTopicRegenLocked, setFullTopicRegenLocked] = useState(false);
  const [allQuestionsGenerated, setAllQuestionsGenerated] = useState(false);
  const [generatingRowId, setGeneratingRowId] = useState<string | null>(null);
  const [generatingAllQuestions, setGeneratingAllQuestions] = useState(false);
  const [customTopicInputV2, setCustomTopicInputV2] = useState("");
  
  // Topic suggestion states
  const [topicSuggestions, setTopicSuggestions] = useState<Array<{label: string; value: string}>>([]);
  const [showingSuggestionsFor, setShowingSuggestionsFor] = useState<string | null>(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [topicInputValues, setTopicInputValues] = useState<{[topicId: string]: string}>({});
  
  // AI-powered topic suggestions for custom topic input
  const [aiTopicSuggestions, setAiTopicSuggestions] = useState<string[]>([]);
  const [loadingAiSuggestions, setLoadingAiSuggestions] = useState(false);
  const [showAiSuggestions, setShowAiSuggestions] = useState(false);
  const [suggestionDebounceTimer, setSuggestionDebounceTimer] = useState<NodeJS.Timeout | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  
  // Preview modal states - consolidated to prevent UI bouncing
  const [previewModal, setPreviewModal] = useState<{
    isOpen: boolean;
    topicId: string | null;
    rowId: string | null;
    topic: TopicV2 | null;
    row: QuestionRow | null;
    questionIndex: number;
    editingQuestion: any | null;
  }>({
    isOpen: false,
    topicId: null,
    rowId: null,
    topic: null,
    row: null,
    questionIndex: 0,
    editingQuestion: null,
  });
  
  // Legacy state for backward compatibility (will be removed gradually)
  const [showSinglePreview, setShowSinglePreview] = useState(false);
  const [singlePreviewTopic, setSinglePreviewTopic] = useState<TopicV2 | null>(null);
  const [singlePreviewRow, setSinglePreviewRow] = useState<QuestionRow | null>(null);
  const [singlePreviewQuestionIndex, setSinglePreviewQuestionIndex] = useState(0);
  const [editingSingleQuestion, setEditingSingleQuestion] = useState<any | null>(null);
  
  const [showBulkPreview, setShowBulkPreview] = useState(false);
  const [bulkPreviewTopics, setBulkPreviewTopics] = useState<TopicV2[]>([]);
  const [bulkPreviewCurrentTopicIndex, setBulkPreviewCurrentTopicIndex] = useState(0);
  const [bulkPreviewCurrentRowIndex, setBulkPreviewCurrentRowIndex] = useState(0);
  const [bulkPreviewCurrentQuestionIndex, setBulkPreviewCurrentQuestionIndex] = useState(0);
  const [editingBulkQuestion, setEditingBulkQuestion] = useState<any | null>(null);

  // Review Questions page states
  const [sectionTimers, setSectionTimers] = useState<{
    MCQ: number;
    Subjective: number;
    PseudoCode: number;
    Coding: number;
  }>({
    MCQ: 0,
    Subjective: 0,
    PseudoCode: 0,
    Coding: 0,
  });
  // Scoring system - per question type (all questions of same type have same score)
  const [scoringRules, setScoringRules] = useState<{
    MCQ: number;
    Subjective: number;
    PseudoCode: number;
    Coding: number;
  }>({
    MCQ: 1,
    Subjective: 4,
    PseudoCode: 6,
    Coding: 10,
  });
  const [expandedQuestionId, setExpandedQuestionId] = useState<string | null>(null);
  const [editingReviewQuestion, setEditingReviewQuestion] = useState<any | null>(null);
  const [scheduleTimeMinutes, setScheduleTimeMinutes] = useState<number>(0);
  const [scheduleTimeWarning, setScheduleTimeWarning] = useState<string | null>(null);
  
  // Proctoring Settings (Station 4)
  const [proctoringSettings, setProctoringSettings] = useState<{
    multiFaceDetection: boolean;
    fullscreenMonitoring: boolean;
    copyPasteBlocking: boolean;
    tabSwitchDetection: boolean;
    frameMatchRecognition: boolean;
    externalDeviceDetection: boolean;
    concentrationTracking: boolean;
    browserExtensionMonitoring: boolean;
    liveCameraAndScreenMonitoring: boolean;
  }>({
    multiFaceDetection: false,
    fullscreenMonitoring: false,
    copyPasteBlocking: false,
    tabSwitchDetection: false,
    frameMatchRecognition: false,
    externalDeviceDetection: false,
    concentrationTracking: false,
    browserExtensionMonitoring: false,
    liveCameraAndScreenMonitoring: false,
  });
  
  // Schedule settings (Station 4)
  const [visibilityMode, setVisibilityMode] = useState<string>("public");
  const [candidateRequirements, setCandidateRequirements] = useState<{
    requireEmail: boolean;
    requireName: boolean;
    requirePhone: boolean;
    requireResume: boolean;
  }>({
    requireEmail: true,
    requireName: true,
    requirePhone: false,
    requireResume: false,
  });

  const sliderRef = useRef<HTMLDivElement>(null);
  const originalTopicConfigsRef = useRef<Topic[]>([]);
  const minHandleRef = useRef<HTMLDivElement>(null);
  const maxHandleRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const dragTargetRef = useRef<"min" | "max" | null>(null);
  const experienceRef = useRef({ min: experienceMin, max: experienceMax });

  // Update ref when state changes
  useEffect(() => {
    experienceRef.current = { min: experienceMin, max: experienceMax };
    if (minHandleRef.current && maxHandleRef.current) {
      const maxValue = experienceMode === "corporate" ? 20 : 4;
      const minPercent = (experienceMin / maxValue) * 100;
      const maxPercent = (experienceMax / maxValue) * 100;
      minHandleRef.current.style.left = `${minPercent}%`;
      maxHandleRef.current.style.left = `${maxPercent}%`;
    }
  }, [experienceMin, experienceMax, experienceMode]);

  // Handle experience range slider
  useEffect(() => {
    // Only initialize slider when on Station 1
    if (currentStation !== 1) return;
    if (!sliderRef.current || !minHandleRef.current || !maxHandleRef.current) return;

    const slider = sliderRef.current;
    const minHandle = minHandleRef.current;
    const maxHandle = maxHandleRef.current;

    const getValueFromPosition = (x: number) => {
      const rect = slider.getBoundingClientRect();
      const percentage = Math.max(0, Math.min(100, ((x - rect.left) / rect.width) * 100));
      // For corporate: 0-20 years, For student: 0-4 academic years
      const maxValue = experienceMode === "corporate" ? 20 : 4;
      return Math.round((percentage / 100) * maxValue);
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !dragTargetRef.current) return;
      
      const value = getValueFromPosition(e.clientX);
      const { min: currentMin, max: currentMax } = experienceRef.current;
      
      const maxValue = experienceMode === "corporate" ? 20 : 4;
      if (dragTargetRef.current === "min") {
        const newMin = Math.max(0, Math.min(value, currentMax - 1));
        experienceRef.current.min = newMin;
        const minPercent = (newMin / maxValue) * 100;
        minHandle.style.left = `${minPercent}%`;
        setExperienceMin(newMin);
      } else {
        const newMax = Math.max(currentMin + 1, Math.min(value, maxValue));
        experienceRef.current.max = newMax;
        const maxPercent = (newMax / maxValue) * 100;
        maxHandle.style.left = `${maxPercent}%`;
        setExperienceMax(newMax);
      }
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      dragTargetRef.current = null;
    };

    const minMouseDown = (e: MouseEvent) => {
      isDraggingRef.current = true;
      dragTargetRef.current = "min";
      e.preventDefault();
      e.stopPropagation();
    };
    
    const maxMouseDown = (e: MouseEvent) => {
      isDraggingRef.current = true;
      dragTargetRef.current = "max";
      e.preventDefault();
      e.stopPropagation();
    };

    minHandle.addEventListener("mousedown", minMouseDown);
    maxHandle.addEventListener("mousedown", maxMouseDown);
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    // Initial position
    const maxValue = experienceMode === "corporate" ? 20 : 4;
    const minPercent = (experienceMin / maxValue) * 100;
    const maxPercent = (experienceMax / maxValue) * 100;
    minHandle.style.left = `${minPercent}%`;
    maxHandle.style.left = `${maxPercent}%`;

    return () => {
      minHandle.removeEventListener("mousedown", minMouseDown);
      maxHandle.removeEventListener("mousedown", maxMouseDown);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [currentStation, experienceMin, experienceMax, experienceMode]);

  // Auto-calculate section timers when topicsV2 changes or when entering Station 3
  useEffect(() => {
    if (currentStation !== 3) return;
    
    // Extract all questions from topicsV2
    const allQuestions: Array<{
      question: any;
      questionType: string;
      difficulty: string;
      topicId: string;
      rowId: string;
      questionIndex: number;
      topicLabel: string;
    }> = [];
    
    // Aggregate questions from ALL topics including custom topics
    topicsV2.forEach((topic) => {
      topic.questionRows.forEach((row) => {
        // Include questions if they exist and status is "generated" or "completed"
        const rowStatus = row.status;
        const isGeneratedOrCompleted = rowStatus === "generated" || rowStatus === "completed";
        if (row.questions && row.questions.length > 0 && isGeneratedOrCompleted) {
          row.questions.forEach((question, qIdx) => {
            allQuestions.push({
              question,
              questionType: row.questionType,
              difficulty: row.difficulty,
              topicId: topic.id,
              rowId: row.rowId,
              questionIndex: qIdx,
              topicLabel: topic.label,
            });
          });
        }
      });
    });
    
    // Group by question type
    const questionsByType: {
      MCQ: Array<{ questionType: string; difficulty: string }>;
      Subjective: Array<{ questionType: string; difficulty: string }>;
      PseudoCode: Array<{ questionType: string; difficulty: string }>;
      Coding: Array<{ questionType: string; difficulty: string }>;
    } = {
      MCQ: [],
      Subjective: [],
      PseudoCode: [],
      Coding: [],
    };
    
    allQuestions.forEach((q) => {
      const type = q.questionType as keyof typeof questionsByType;
      if (questionsByType[type]) {
        questionsByType[type].push({
          questionType: q.questionType,
          difficulty: q.difficulty,
        });
      }
    });
    
    // Calculate timers for each section
    const newTimers = {
      MCQ: calculateSectionTimer(questionsByType.MCQ),
      Subjective: calculateSectionTimer(questionsByType.Subjective),
      PseudoCode: calculateSectionTimer(questionsByType.PseudoCode),
      Coding: calculateSectionTimer(questionsByType.Coding),
    };
    
    // Only update if values have changed
    setSectionTimers((prev) => {
      if (
        prev.MCQ !== newTimers.MCQ ||
        prev.Subjective !== newTimers.Subjective ||
        prev.PseudoCode !== newTimers.PseudoCode ||
        prev.Coding !== newTimers.Coding
      ) {
        return newTimers;
      }
      return prev;
    });
  }, [currentStation, topicsV2]);

  // Auto-calculate initial scores when questions are loaded in Review Questions page
  useEffect(() => {
    if (currentStation !== 3 || !topicsV2 || topicsV2.length === 0) return;
    
    // Extract all questions grouped by type
    const questionsByType: { [key: string]: Array<{ difficulty: string }> } = {
      MCQ: [],
      Subjective: [],
      PseudoCode: [],
      Coding: [],
    };
    
    // Aggregate questions from ALL topics including custom topics
    topicsV2.forEach((topic) => {
      topic.questionRows.forEach((row) => {
        // Include questions if they exist and status is "generated" or "completed"
        const rowStatus = row.status;
        const isGeneratedOrCompleted = rowStatus === "generated" || rowStatus === "completed";
        if (row.questions && row.questions.length > 0 && isGeneratedOrCompleted) {
          const questionType = row.questionType;
          if (questionsByType[questionType]) {
            row.questions.forEach(() => {
              questionsByType[questionType].push({ difficulty: row.difficulty });
            });
          }
        }
      });
    });
    
    // Calculate initial scores based on first question of each type
    // Only update if scoring rules are at default values (not manually set)
    setScoringRules((prev) => {
      const newScoringRules = { ...prev };
      let hasChanges = false;
      
      (["MCQ", "Subjective", "PseudoCode", "Coding"] as const).forEach((questionType) => {
        const typeQuestions = questionsByType[questionType];
        if (typeQuestions.length > 0) {
          // Get difficulty of first question
          const firstDifficulty = typeQuestions[0].difficulty;
          const suggestedScore = getDefaultScore(questionType, firstDifficulty);
          
          // Only auto-set if it's still at the initial default value
          // This allows manual edits to persist
          const defaultEasy = getDefaultScore(questionType, "Easy");
          if (prev[questionType] === defaultEasy || prev[questionType] === 0) {
            if (prev[questionType] !== suggestedScore) {
              newScoringRules[questionType] = suggestedScore;
              hasChanges = true;
            }
          }
        }
      });
      
      return hasChanges ? newScoringRules : prev;
    });
  }, [currentStation, topicsV2]);

  // Save timer settings, scoring rules, and pass percentage to draft when they change
  useEffect(() => {
    if (currentStation !== 3 || !assessmentId) return;
    
    // Debounce draft updates
    const timeoutId = setTimeout(() => {
      axios.put("/api/assessments/update-draft", {
        assessmentId,
        sectionTimers,
        enablePerSectionTimers,
        scoringRules,
        passPercentage,
      }).catch((err) => {
        console.error("Error saving review settings to draft:", err);
      });
    }, 1000);
    
    return () => clearTimeout(timeoutId);
  }, [currentStation, assessmentId, sectionTimers, enablePerSectionTimers, scoringRules, passPercentage]);

  // Clear all state function for new assessment
  const clearAllState = () => {
    setAssessmentId(null);
    setJobDesignation("");
    setTopicCards([]);
    setSelectedSkills([]);
    setManualSkillInput("");
    setTopics([]);
    setExperienceMin(0);
    setExperienceMax(10);
    setExperienceMode("corporate");
    setTopicConfigs([]);
    setTopicsV2([]);
    setQuestions([]);
    setPreviewQuestions([]);
    setFullTopicRegenLocked(false);
    setAllQuestionsGenerated(false);
    setCurrentStation(1);
    setHasVisitedConfigureStation(false);
    setHasVisitedReviewStation(false);
    setError(null);
    setLoading(false);
    setGeneratingRowId(null);
    setGeneratingAllQuestions(false);
    setShowSinglePreview(false);
    setShowBulkPreview(false);
    setSinglePreviewTopic(null);
    setSinglePreviewRow(null);
    setBulkPreviewTopics([]);
    setEditingSingleQuestion(null);
    setEditingBulkQuestion(null);
    setInitialLoadDone(false); // Reset initial load flag
    console.log("✅ All state cleared for new assessment");
  };

  // Load draft ONLY when explicitly in edit mode (URL has id parameter)
  useEffect(() => {
    if (isEditMode && id && typeof id === 'string') {
      // Edit/Continue Draft mode: load the draft assessment specified in URL
      console.log("📝 Edit mode: Loading draft assessment", id);
      loadDraftAssessment(id);
    } else if (!isEditMode) {
      // CREATE NEW mode: Clear all state and start fresh
      console.log("🆕 Create New mode: Starting fresh assessment");
      clearAllState();
      setInitialLoadDone(true); // Allow auto-save immediately for new assessments
    }
  }, [isEditMode, id]);

  // Keep preview index within bounds when questions change (but don't interfere with user navigation)
  useEffect(() => {
    const questionsToShow = previewQuestions.length > 0 ? previewQuestions : questions;
    const totalQuestions = questionsToShow.length;
    
    // Only adjust if index is truly out of bounds (don't run on every index change)
    if (totalQuestions > 0) {
      setCurrentPreviewIndex((prevIndex) => {
        // Only adjust if index is out of bounds
        if (prevIndex >= totalQuestions) {
          const newIndex = totalQuestions - 1;
          console.log(`[Preview] Index out of bounds, adjusting: ${prevIndex} -> ${newIndex} (total: ${totalQuestions})`);
          return newIndex;
        } else if (prevIndex < 0) {
          console.log(`[Preview] Index negative, resetting to 0`);
          return 0;
        }
        // Otherwise, preserve the current index (user navigation)
        return prevIndex;
      });
    }
  }, [previewQuestions.length, questions.length]); // Removed currentPreviewIndex from dependencies

  // SINGLE DRAFT LOGIC: Auto-save draft on changes (debounced)
  // Only auto-save if we have an assessmentId (draft exists) AND initial load is complete
  useEffect(() => {
    if (!assessmentId) return; // No draft yet, don't auto-save
    if (!initialLoadDone) return; // Don't auto-save until initial load from edit mode is complete

    // Debounce draft saves to avoid too many API calls
    const timeoutId = setTimeout(async () => {
      try {
        const titleToSave = finalTitle || (jobDesignation.trim() ? `Assessment for ${jobDesignation.trim()}` : "Untitled Assessment");
        
        const draftData: any = {
          assessmentId: assessmentId,
          title: titleToSave,
          description: finalDescription || "",
          jobDesignation: jobDesignation.trim(),
          selectedSkills: selectedSkills,
          experienceMin: experienceMin,
          experienceMax: experienceMax,
          experienceMode: experienceMode,
        };

        // Add topics_v2 if configured (new structure)
        if (topicsV2 && topicsV2.length > 0) {
          draftData.topics_v2 = topicsV2;
        }

        // Add old topics structure if still in use
        if (topicConfigs.length > 0) {
          draftData.topics = topicConfigs;
        }

        // Add preview questions if available
        if (previewQuestions.length > 0) {
          draftData.previewQuestions = previewQuestions;
        }

        // Add questions if available
        if (questions.length > 0) {
          draftData.questions = questions;
          draftData.questionTypeTimes = questionTypeTimes;
          draftData.enablePerSectionTimers = enablePerSectionTimers;
          draftData.passPercentage = passPercentage;
        }

        // Add schedule if available
        if (startTime && endTime) {
          const normalizeDateTime = (dt: string): string => {
            if (!dt) return dt;
            if (dt.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)) {
              const dtWithSeconds = dt + ":00";
              const istDate = new Date(dtWithSeconds + "+05:30");
              if (!isNaN(istDate.getTime())) {
                return istDate.toISOString();
              } else {
                return dt + ":00Z";
              }
            }
            if (dt.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)) {
              return dt + "Z";
            }
            return dt;
          };
          
          draftData.schedule = {
            startTime: normalizeDateTime(startTime),
            endTime: normalizeDateTime(endTime),
          };
        }

        // Add candidates if available
        if (candidates.length > 0) {
          draftData.candidates = candidates;
        }

        if (assessmentUrl) {
          draftData.assessmentUrl = assessmentUrl;
        }

        // Fire-and-forget save (don't block UI)
        axios.put("/api/assessments/update-draft", draftData).catch((err) => {
          console.error("Error auto-saving draft:", err);
        });
      } catch (err: any) {
        console.error("Error preparing draft data:", err);
      }
    }, 2000); // 2 second debounce

    return () => clearTimeout(timeoutId);
  }, [
    assessmentId,
    initialLoadDone, // Add initialLoadDone to dependencies
    finalTitle,
    finalDescription,
    jobDesignation,
    selectedSkills,
    proctoringSettings,
    startTime,
    endTime,
    visibilityMode,
    candidateRequirements,
    experienceMin,
    experienceMax,
    experienceMode,
    topicsV2,
    topicConfigs,
    previewQuestions,
    questions,
    questionTypeTimes,
    enablePerSectionTimers,
    passPercentage,
    startTime,
    endTime,
    candidates,
    assessmentUrl,
  ]);

  // Auto-fetch skills when jobDesignation or experience range changes (with 1 second debounce)
  // Auto-generate skills when Assessment Title, Job Designation, Experience Range, or Experience Mode changes
  useEffect(() => {
    // Don't generate if job designation is empty
    if (!jobDesignation.trim()) {
      setTopicCards([]);
      return;
    }

    // Skip topic card regeneration in edit mode (topics already loaded from draft)
    if (isEditMode) {
      return; // Don't regenerate topic cards in edit mode
    }
    
    // Only fetch if we haven't visited configure station yet
    if (hasVisitedConfigureStation) {
      return;
    }

    // Debounce the API call to reduce load
    const timeoutId = setTimeout(async () => {
      setLoadingCards(true);
      setError(null);

      try {
        const response = await axios.post("/api/assessments/generate-topic-cards", {
          jobDesignation: jobDesignation.trim(),
          experienceMin: experienceMin,
          experienceMax: experienceMax,
          experienceMode: experienceMode,
          assessmentTitle: finalTitle.trim() || undefined, // Include title if provided
        });

        if (response.data?.success) {
          // Only update topic cards - don't touch selectedSkills (manual skills are preserved)
          setTopicCards(response.data.data.cards || []);
        } else {
          setError("Failed to generate topic cards");
        }
      } catch (err: any) {
        console.error("Error generating topic cards:", err);
        setError(err.response?.data?.message || err.message || "Failed to generate topic cards");
      } finally {
        setLoadingCards(false);
      }
    }, 1000); // 1 second debounce

    return () => clearTimeout(timeoutId);
  }, [finalTitle, jobDesignation, experienceMin, experienceMax, experienceMode, isEditMode, hasVisitedConfigureStation]);

  // Constrain experience range when mode changes
  useEffect(() => {
    if (experienceMode === "student") {
      // For students: 0-4 (representing years 1-5)
      if (experienceMin > 4) setExperienceMin(4);
      if (experienceMax > 4) setExperienceMax(4);
      if (experienceMin >= experienceMax) {
        setExperienceMax(Math.min(experienceMin + 1, 4));
      }
    } else {
      // For corporate: 0-20 years
      if (experienceMin > 20) setExperienceMin(20);
      if (experienceMax > 20) setExperienceMax(20);
      if (experienceMin >= experienceMax) {
        setExperienceMax(Math.min(experienceMin + 1, 20));
      }
    }
  }, [experienceMode]);

  const loadDraftAssessment = async (assessmentId: string) => {
    setLoadingDraft(true);
    setError(null);
    setInitialLoadDone(false); // Reset initial load flag - prevent auto-save during load
    
    try {
      // Fetch assessment data
      const response = await axios.get(`/api/assessments/get-questions?assessmentId=${assessmentId}`);
      
      if (response.data?.success && response.data?.data) {
        const assessmentData = response.data.data;
        // The backend returns assessment in assessmentData.assessment, but also check if it's directly in assessmentData
        const assessment = assessmentData.assessment || assessmentData;
        
        // Debug logging - check ALL possible locations for topics_v2
        console.log("Loading draft assessment:", {
          assessmentId,
          hasAssessment: !!assessment,
          topicsCount: assessment?.topics?.length || 0,
          topicsV2Count: assessment?.topics_v2?.length || 0,
          topicsV2FromData: assessmentData?.topics_v2?.length || 0,
          topics: assessment?.topics,
          topics_v2: assessment?.topics_v2,
          topics_v2_from_data: assessmentData?.topics_v2,
          assessmentDataKeys: Object.keys(assessmentData),
          assessmentKeys: assessment ? Object.keys(assessment) : [],
          fullAssessment: assessment,
        });
        
        // Set assessment ID
        setAssessmentId(assessmentId);
        
        // Load Station 1 data
        if (assessment.jobDesignation) {
          setJobDesignation(assessment.jobDesignation);
        }
        if (assessment.selectedSkills && Array.isArray(assessment.selectedSkills)) {
          // Only set if not already set to prevent duplicates when navigating back
          setSelectedSkills(prev => {
            // If already loaded, don't overwrite (prevents duplicates)
            if (prev.length > 0) {
              return prev;
            }
            return assessment.selectedSkills;
          });
        }
        if (assessment.experienceMin !== undefined) {
          setExperienceMin(assessment.experienceMin);
        }
        if (assessment.experienceMax !== undefined) {
          setExperienceMax(assessment.experienceMax);
        }
        if (assessment.experienceMode) {
          setExperienceMode(assessment.experienceMode);
        }
        if (assessment.title) {
          setFinalTitle(assessment.title);
        }
        if (assessment.availableQuestionTypes) {
          setAvailableQuestionTypes(assessment.availableQuestionTypes);
        }
        
        // Load Station 4 data (Schedule & Proctoring Settings)
        if (assessment.schedule) {
          if (assessment.schedule.startTime) {
            setStartTime(assessment.schedule.startTime);
          }
          if (assessment.schedule.endTime) {
            setEndTime(assessment.schedule.endTime);
          }
          if (assessment.schedule.visibilityMode) {
            setVisibilityMode(assessment.schedule.visibilityMode);
          }
          if (assessment.schedule.candidateRequirements) {
            setCandidateRequirements(assessment.schedule.candidateRequirements);
          }
        }
        
        if (assessment.proctoringSettings) {
          setProctoringSettings(assessment.proctoringSettings);
        }
        
        // Load Station 3 data (Review Questions)
        if (assessment.sectionTimers) {
          setSectionTimers(assessment.sectionTimers);
        }
        if (assessment.scoringRules) {
          setScoringRules(assessment.scoringRules);
        }
        if (assessment.passPercentage !== undefined) {
          setPassPercentage(assessment.passPercentage);
        }
        if (assessment.enablePerSectionTimers !== undefined) {
          setEnablePerSectionTimers(assessment.enablePerSectionTimers);
        }
        
        // Regenerate topic cards for draft (to show Related Technologies & Skills)
        if (assessment.jobDesignation && assessment.jobDesignation.trim()) {
          try {
            setLoadingCards(true);
            const topicCardsResponse = await axios.post("/api/assessments/generate-topic-cards", {
              jobDesignation: assessment.jobDesignation.trim(),
              experienceMin: assessment.experienceMin !== undefined ? assessment.experienceMin : 0,
              experienceMax: assessment.experienceMax !== undefined ? assessment.experienceMax : 10,
              experienceMode: assessment.experienceMode || "corporate",
              assessmentTitle: assessment.title || undefined,
            });
            if (topicCardsResponse.data?.success) {
              setTopicCards(topicCardsResponse.data.data.cards || []);
            }
          } catch (err: any) {
            console.error("Error loading topic cards for draft:", err);
            // Don't show error, just continue loading
          } finally {
            setLoadingCards(false);
          }
        }
        
        // Load Station 2 data (topics configuration)
        // PRIORITY: Load topics_v2 if available (new v2 format) - this is the primary format
        // Check multiple possible locations: assessment.topics_v2, assessmentData.topics_v2, response.data.data.topics_v2
        const topicsV2ToLoad = assessment.topics_v2 || assessmentData.topics_v2 || response.data?.data?.topics_v2 || null;
        
        console.log("🔍 Checking for topics_v2:", {
          fromAssessment: !!assessment.topics_v2,
          fromAssessmentData: !!assessmentData.topics_v2,
          fromResponseData: !!response.data?.data?.topics_v2,
          topicsV2ToLoad: topicsV2ToLoad ? (Array.isArray(topicsV2ToLoad) ? topicsV2ToLoad.length : "not array") : null,
        });
        
        if (topicsV2ToLoad && Array.isArray(topicsV2ToLoad) && topicsV2ToLoad.length > 0) {
          console.log(`✅ Found topics_v2 to load: ${topicsV2ToLoad.length} topics`);
          // Deep clone to ensure we have a fresh copy
          const restoredTopicsV2 = JSON.parse(JSON.stringify(topicsV2ToLoad));
          
          // Ensure all questionRows have proper structure
          restoredTopicsV2.forEach((topic: any) => {
            // Ensure questionRows array exists
            if (!topic.questionRows || !Array.isArray(topic.questionRows)) {
              topic.questionRows = [];
            }
            
            // Ensure each questionRow has all required fields with defaults
            topic.questionRows.forEach((row: any) => {
              // Ensure status defaults to "pending" if not set
              if (!row.status) {
                row.status = row.questions && row.questions.length > 0 ? "generated" : "pending";
              }
              
              // IMPORTANT: locked should ONLY be true if questions are generated AND exist
              // If status is "pending" or questions don't exist, locked MUST be false
              if (row.status === "pending" || !row.questions || row.questions.length === 0) {
                row.locked = false;
              } else if (row.locked === undefined) {
                // Only set locked to true if status is "generated" AND questions exist
                row.locked = row.status === "generated" && row.questions && row.questions.length > 0;
              }
              
              // Ensure questions array exists
              if (!row.questions) {
                row.questions = [];
              }
              
              // Ensure rowId exists
              if (!row.rowId) {
                row.rowId = `row_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
              }
            });
            
            // Ensure topic has id
            if (!topic.id) {
              topic.id = `topic_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            }
          });
          
          setTopicsV2(restoredTopicsV2);
          setFullTopicRegenLocked(assessment.fullTopicRegenLocked || false);
          setAllQuestionsGenerated(assessment.allQuestionsGenerated || false);
          setHasVisitedConfigureStation(true);
          
          // Auto-navigate to Station 2 if topics exist
          if (restoredTopicsV2.length > 0) {
            setCurrentStation(2);
          }
          
          console.log("✅ Topics_v2 fully restored:", {
            topicsV2Count: restoredTopicsV2.length,
            topicsV2: restoredTopicsV2.map((t: any) => ({
              id: t.id,
              label: t.label,
              locked: t.locked,
              questionRowsCount: t.questionRows?.length || 0,
              questionRows: t.questionRows?.map((r: any) => ({
                rowId: r.rowId,
                questionType: r.questionType,
                difficulty: r.difficulty,
                questionsCount: r.questionsCount,
                status: r.status,
                locked: r.locked,
                generatedQuestionsCount: r.questions?.length || 0,
              })),
            })),
            fullTopicRegenLocked: assessment.fullTopicRegenLocked || assessmentData.fullTopicRegenLocked || false,
            allQuestionsGenerated: assessment.allQuestionsGenerated || assessmentData.allQuestionsGenerated || false,
            navigatedToStation2: true,
          });
        } else {
          console.warn("⚠️ No topics_v2 found in assessment. Available keys:", {
            assessmentKeys: assessment ? Object.keys(assessment) : [],
            assessmentDataKeys: Object.keys(assessmentData),
            responseDataKeys: response.data?.data ? Object.keys(response.data.data) : [],
            topicsV2ToLoad: topicsV2ToLoad,
          });
        }
        
        // Check both assessment.topics and assessmentData.topics (backend might return topics separately)
        // Only load old format if topics_v2 is not available
        const topicsToLoad = (!assessment.topics_v2 || assessment.topics_v2.length === 0) 
          ? (assessment.topics || assessmentData.topics || [])
          : [];
        console.log("Topics to load (old format):", {
          fromAssessment: assessment.topics?.length || 0,
          fromAssessmentData: assessmentData.topics?.length || 0,
          topicsToLoad: topicsToLoad.length,
          topics: topicsToLoad,
          topicsV2: assessment.topics_v2?.length || 0,
          usingOldFormat: topicsToLoad.length > 0,
        });
        
        if (topicsToLoad && topicsToLoad.length > 0) {
          const isAptitude = assessment.isAptitudeAssessment || false;
          setTopics(topicsToLoad.map((t: any) => t.topic || t));
          
          const configs = topicsToLoad.map((t: any) => {
            const isTopicAptitude = t.isAptitude === true || (isAptitude && t.category === "aptitude");
            
            // Load question type configs from questionConfigs if available
            let questionTypeConfigs: QuestionTypeConfig[] = [];
            
            if (t.questionConfigs && t.questionConfigs.length > 0) {
              // Group by question type and difficulty
              const configMap: { [key: string]: QuestionTypeConfig } = {};
              for (const qc of t.questionConfigs) {
                // Handle both plain objects and MongoDB documents
                const qcType = (typeof qc === 'object' && qc !== null) ? (qc.type || (qc as any).get?.("type")) : null;
                const qcDifficulty = (typeof qc === 'object' && qc !== null) ? (qc.difficulty || (qc as any).get?.("difficulty")) : null;
                const qcLanguage = (typeof qc === 'object' && qc !== null) ? (qc.language || (qc as any).get?.("language")) : undefined;
                const qcJudge0 = (typeof qc === 'object' && qc !== null) ? 
                  (qc.judge0_enabled !== undefined ? qc.judge0_enabled : ((qc as any).get?.("judge0_enabled") !== undefined ? (qc as any).get("judge0_enabled") : undefined)) : 
                  undefined;
                
                const type = qcType || "MCQ";
                const difficulty = qcDifficulty || "Medium";
                const key = `${type}_${difficulty}`;
                
                if (!configMap[key]) {
                  configMap[key] = {
                    questionType: type,
                    difficulty: difficulty,
                    numQuestions: 0,
                    language: qcLanguage,
                    judge0_enabled: qcJudge0,
                  };
                }
                configMap[key].numQuestions++;
              }
              questionTypeConfigs = Object.values(configMap);
            } else if (t.questionTypes && t.questionTypes.length > 0) {
              // Fallback: create configs from questionTypes array
              questionTypeConfigs = t.questionTypes.map((qt: string) => ({
                questionType: qt,
                difficulty: t.difficulty || "Medium",
                numQuestions: Math.floor((t.numQuestions || 1) / t.questionTypes.length) || 1,
                language: qt === "coding" ? (t.language || getLanguageFromTopic(t.topic)) : undefined,
                judge0_enabled: qt === "coding" ? (t.judge0_enabled !== undefined ? t.judge0_enabled : true) : undefined,
              }));
            } else {
              // Default: single question type
              const questionType = availableQuestionTypes[0] || QUESTION_TYPES[0];
              questionTypeConfigs = [{
                questionType: questionType,
                difficulty: t.difficulty || "Medium",
                numQuestions: t.numQuestions || 1,
                language: questionType === "coding" ? (t.language || getLanguageFromTopic(t.topic)) : undefined,
                judge0_enabled: questionType === "coding" ? (t.judge0_enabled !== undefined ? t.judge0_enabled : true) : undefined,
              }];
            }
            
            if (isTopicAptitude) {
              const availableSubTopics = t.availableSubTopics || t.subTopics || [];
              const defaultSubTopic = availableSubTopics.length > 0 ? availableSubTopics[0] : undefined;
              const selectedSubTopic = t.subTopic || defaultSubTopic;
              
              return {
                topic: t.topic,
                questionTypeConfigs: questionTypeConfigs,
                isAptitude: true,
                subTopic: selectedSubTopic,
                aptitudeStructure: t.aptitudeStructure || undefined,
                availableSubTopics: availableSubTopics,
              };
            } else {
              return {
                topic: t.topic,
                questionTypeConfigs: questionTypeConfigs,
                isAptitude: false,
                coding_supported: t.coding_supported !== undefined ? t.coding_supported : undefined,
              };
            }
          });
          
          setTopicConfigs(configs);
          originalTopicConfigsRef.current = JSON.parse(JSON.stringify(configs));
          setHasVisitedConfigureStation(true);
          
          // Debug logging
          console.log("Topic configs loaded:", {
            configsCount: configs.length,
            configs: configs,
          });
        }
        
        // Note: topics_v2 loading is now handled above with full restoration
        // This section is only for old format topics (if topics_v2 doesn't exist)
        if (!assessment.topics_v2 || assessment.topics_v2.length === 0) {
          if (!topicsToLoad || topicsToLoad.length === 0) {
            // Debug logging if no topics found
            console.log("⚠️ No topics found in assessment:", {
              assessmentId,
              hasTopics: !!assessment.topics,
              topicsLength: assessment.topics?.length || 0,
              hasTopicsV2: !!assessment.topics_v2,
              topicsV2Length: assessment.topics_v2?.length || 0,
              hasTopicsInData: !!topicsToLoad,
              topicsToLoadLength: topicsToLoad?.length || 0,
              assessmentKeys: Object.keys(assessment),
              assessmentDataKeys: Object.keys(assessmentData),
            });
          }
        }
        
        // Load Station 3 data (questions)
        if (assessmentData.questions && assessmentData.questions.length > 0) {
          setQuestions(assessmentData.questions);
          setHasVisitedReviewStation(true);
          
          // Load question type times if available
          if (assessment.questionTypeTimes) {
            setQuestionTypeTimes(assessment.questionTypeTimes);
          }
          if (assessment.enablePerSectionTimers !== undefined) {
            setEnablePerSectionTimers(assessment.enablePerSectionTimers);
          }
          
          // Load section timers if available
          if (assessment.sectionTimers) {
            setSectionTimers(assessment.sectionTimers);
          }
          
          // Load scoring rules if available
          if (assessment.scoringRules) {
            setScoringRules(assessment.scoringRules);
          }
          
          // Load pass percentage if available
          if (assessment.passPercentage !== undefined) {
            setPassPercentage(assessment.passPercentage);
          }
        }
        
        // Load Station 4 data (schedule)
        if (assessment.schedule) {
          const schedule = assessment.schedule;
          if (schedule.startTime) {
            // Convert ISO string to datetime-local format
            const startDate = new Date(schedule.startTime);
            const startLocal = new Date(startDate.getTime() - startDate.getTimezoneOffset() * 60000)
              .toISOString()
              .slice(0, 16);
            setStartTime(startLocal);
          }
          if (schedule.endTime) {
            const endDate = new Date(schedule.endTime);
            const endLocal = new Date(endDate.getTime() - endDate.getTimezoneOffset() * 60000)
              .toISOString()
              .slice(0, 16);
            setEndTime(endLocal);
          }
          if (schedule.visibilityMode) {
            setVisibilityMode(schedule.visibilityMode);
          }
          if (schedule.candidateRequirements) {
            setCandidateRequirements(schedule.candidateRequirements);
          }
        }
        
        // Load proctoring settings
        if (assessment.proctoringSettings) {
          setProctoringSettings(assessment.proctoringSettings);
        }
        
        // Load Station 5 data (candidates, URL, accessMode, invitationTemplate)
        if (assessment.candidates && assessment.candidates.length > 0) {
          setCandidates(assessment.candidates);
        }
        if (assessment.assessmentUrl) {
          setAssessmentUrl(assessment.assessmentUrl);
        }
        if (assessment.accessMode) {
          setAccessMode(assessment.accessMode);
        }
        if (assessment.invitationTemplate) {
          setInvitationTemplate(assessment.invitationTemplate);
        }
        
        // Load finalization data (always load, even if empty/placeholder)
        setFinalTitle(assessment.title || "");
        setFinalDescription(assessment.description || "");
        if (assessment.passPercentage !== undefined) {
          setPassPercentage(assessment.passPercentage);
        }
        
        // Load preview questions if available
        if (assessment.previewQuestions && Array.isArray(assessment.previewQuestions) && assessment.previewQuestions.length > 0) {
          console.log(`[Preview] Loading ${assessment.previewQuestions.length} preview questions from draft`);
          setPreviewQuestions(assessment.previewQuestions);
          setCurrentPreviewIndex(0);
          
          // Also convert preview questions to questions for review page if questions don't exist
          if (!assessmentData.questions || assessmentData.questions.length === 0) {
            console.log(`[Preview] Converting ${assessment.previewQuestions.length} preview questions to questions for review page`);
            setQuestions(assessment.previewQuestions);
          }
        } else {
          console.log("[Preview] No preview questions in draft:", {
            hasPreviewQuestions: !!assessment.previewQuestions,
            isArray: Array.isArray(assessment.previewQuestions),
            length: assessment.previewQuestions?.length || 0,
          });
        }
        
        // SINGLE DRAFT: No need to store in localStorage - backend maintains single draft
        
        // Determine which station to show based on what's been completed
        // PRIORITY: Check topics_v2 first (new format)
        // Also respect saved currentStation if available
        if (assessment.currentStation !== undefined && assessment.currentStation > 0) {
          setCurrentStation(assessment.currentStation);
          console.log(`✅ Restored currentStation from draft: ${assessment.currentStation}`);
        } else if (assessment.status === "ready" || assessment.status === "scheduled") {
          setCurrentStation(5); // Show candidates station if finalized
        } else if (assessment.candidates && assessment.candidates.length > 0) {
          setCurrentStation(5);
        } else if (assessment.schedule) {
          setCurrentStation(4);
        } else if (assessmentData.questions && assessmentData.questions.length > 0) {
          setCurrentStation(3);
        } else if ((assessment.topics_v2 && assessment.topics_v2.length > 0) || (assessment.topics && assessment.topics.length > 0)) {
          // Navigate to Station 2 if topics exist (either format)
          setCurrentStation(2);
        } else {
          setCurrentStation(1);
        }
        
        // Mark initial load as complete AFTER all states are populated
        // This prevents auto-save from overwriting topics before they're loaded
        setInitialLoadDone(true);
        console.log("✅ Initial load complete - auto-save now enabled", {
          topicsV2Count: assessment.topics_v2?.length || 0,
          topicsCount: assessment.topics?.length || 0,
          topicConfigsCount: topicConfigs.length,
          questionsCount: assessmentData.questions?.length || 0,
          currentStation: assessment.currentStation || "auto-determined",
        });
      }
    } catch (err: any) {
      console.error("Error loading draft assessment:", err);
      
      // If assessment not found (404), just continue with new assessment
      if (err.response?.status === 404 || err.response?.status === 400) {
        console.log("Assessment not found, will create new draft when needed");
        // Don't show error to user - just silently continue with new assessment
        setError(null);
        setInitialLoadDone(true); // Allow auto-save even if assessment not found
      } else {
        // For other errors, show the error message
        setError(err.response?.data?.message || err.message || "Failed to load draft assessment");
        setInitialLoadDone(true); // Still allow auto-save to prevent blocking
      }
    } finally {
      setLoadingDraft(false);
      // Ensure initialLoadDone is set even if there was an error
      if (!initialLoadDone) {
        setInitialLoadDone(true);
      }
    }
  };

  const handleGenerateTopicCards = async () => {
    if (!jobDesignation.trim()) {
      setError("Please enter a job designation");
      return;
    }

    setLoadingCards(true);
    setError(null);

    try {
      const response = await axios.post("/api/assessments/generate-topic-cards", {
        jobDesignation: jobDesignation.trim(),
        experienceMin: experienceMin,
        experienceMax: experienceMax,
        experienceMode: experienceMode,
        assessmentTitle: finalTitle.trim() || undefined,
      });

      if (response.data?.success) {
        setTopicCards(response.data.data.cards || []);
      } else {
        setError("Failed to generate topic cards");
      }
    } catch (err: any) {
      console.error("Error generating topic cards:", err);
      setError(err.response?.data?.message || err.message || "Failed to generate topic cards");
    } finally {
      setLoadingCards(false);
    }
  };

  const handleCardClick = (card: string) => {
    if (!selectedSkills.includes(card)) {
      setSelectedSkills([...selectedSkills, card]);
    }
  };

  const handleAddManualSkill = () => {
    if (manualSkillInput.trim() && !selectedSkills.includes(manualSkillInput.trim())) {
      setSelectedSkills([...selectedSkills, manualSkillInput.trim()]);
      setManualSkillInput("");
    }
  };

  const handleRemoveSkill = (skillToRemove: string) => {
    setSelectedSkills(selectedSkills.filter((s) => s !== skillToRemove));
  };

  const handleGenerateTopics = async () => {
    if (selectedSkills.length === 0) {
      setError("Please select at least one skill to assess");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // If editing and assessment already exists, skip creation and just update topics
      if (isEditMode && assessmentId) {
        // For editing, we'll update the existing assessment's topics
        // Call create-from-job-designation which will update existing assessment
        const response = await axios.post("/api/assessments/create-from-job-designation", {
          assessmentId: assessmentId, // Pass assessmentId to update existing instead of creating new
          jobDesignation: jobDesignation.trim(),
          selectedSkills: selectedSkills,
          experienceMin: experienceMin.toString(),
          experienceMax: experienceMax.toString(),
          experienceMode: experienceMode,
        });
        
        // If a new assessment was created, use its ID; otherwise keep the existing one
        if (response.data?.success) {
          const data = response.data.data;
          const newAssessmentId = data.assessment._id || data.assessment.id;
          // Only update if we got a different ID (shouldn't happen, but safety check)
          if (newAssessmentId !== assessmentId) {
            setAssessmentId(newAssessmentId);
          }
          
          // IMPORTANT: Use the response data directly (it's already the updated assessment)
          // No need to fetch again - the backend returns the updated assessment
          const updatedAssessment = data.assessment;
          const isAptitude = updatedAssessment?.isAptitudeAssessment || false;
          
          console.log(`[Regenerate Topics] Updated topics from response:`, updatedAssessment.topics?.map((t: any) => t.topic));
          console.log(`[Regenerate Topics] Total topics: ${updatedAssessment.topics?.length || 0}`);
          
          // Update state immediately with new topics
          setTopics(updatedAssessment.topics.map((t: any) => t.topic));
          setAvailableQuestionTypes(data.questionTypes || QUESTION_TYPES);
          
          setTopicConfigs(
            updatedAssessment.topics.map((t: any) => {
              const isTopicAptitude = t.isAptitude === true || (isAptitude && t.category === "aptitude");
              
              if (isTopicAptitude) {
                const availableSubTopics = t.availableSubTopics || t.subTopics || [];
                const defaultSubTopic = availableSubTopics.length > 0 ? availableSubTopics[0] : undefined;
                const selectedSubTopic = t.subTopic || defaultSubTopic;
                
                let defaultQuestionType = "MCQ";
                if (selectedSubTopic && t.aptitudeStructure?.subTopics?.[selectedSubTopic]) {
                  const questionTypes = t.aptitudeStructure.subTopics[selectedSubTopic];
                  defaultQuestionType = questionTypes.length > 0 ? questionTypes[0] : "MCQ";
                }
                
                return {
                  topic: t.topic,
                  questionTypeConfigs: [{
                    questionType: defaultQuestionType,
                    difficulty: t.difficulty || "Medium",
                    numQuestions: 1,
                  }],
                  isAptitude: true,
                  subTopic: selectedSubTopic,
                  aptitudeStructure: t.aptitudeStructure || undefined,
                  availableSubTopics: availableSubTopics,
                };
              } else {
                // Handle technical topic
                const questionType = t.questionTypes?.[0] || data.questionTypes?.[0] || QUESTION_TYPES[0];
                const isCoding = questionType === "coding";
                // Auto-detect language for coding questions
                const autoLanguage = isCoding ? getLanguageFromTopic(t.topic) : undefined;
                
                return {
                  topic: t.topic,
                  questionTypeConfigs: [{
                    questionType: questionType,
                    difficulty: t.difficulty || "Medium",
                    numQuestions: 1,
                    language: autoLanguage,
                    judge0_enabled: isCoding ? true : undefined,
                  }],
                  isAptitude: false,
                  coding_supported: t.coding_supported !== undefined ? t.coding_supported : (isCoding ? true : undefined),
                };
              }
            })
          );
        }
        setLoading(false);
        // After generating topics in edit mode, navigate to Station 2
        setCurrentStation(2);
        return;
      }
      
      // CREATE NEW: Do NOT pass assessmentId - backend will create a brand new draft
      // Only pass assessmentId if we're explicitly in edit mode
      const topicsResponse = await axios.post("/api/assessments/generate-topics-v2", {
        // Only pass assessmentId if in edit mode - for new assessments, always omit it
        assessmentId: (isEditMode && assessmentId) ? assessmentId : undefined,
        assessmentTitle: finalTitle.trim() || undefined,
        jobDesignation: jobDesignation.trim(),
        selectedSkills: selectedSkills,
        experienceMin: experienceMin,
        experienceMax: experienceMax,
        experienceMode: experienceMode,
      });
      
      if (topicsResponse.data?.success) {
        const topicsData = topicsResponse.data.data;
        const returnedAssessmentId = topicsData.assessmentId;
        
        // Update assessmentId if we got one back (new draft created or existing found)
        if (returnedAssessmentId && returnedAssessmentId !== assessmentId) {
          setAssessmentId(returnedAssessmentId);
        }
        
        // Update topics_v2 in the assessment
        if (topicsData.topics) {
          setTopicsV2(topicsData.topics);
          setFullTopicRegenLocked(false);
          setAllQuestionsGenerated(false);
        }
        
        // Fetch the updated assessment to get the full data
        const finalAssessmentId = returnedAssessmentId || assessmentId;
        if (finalAssessmentId) {
          const assessmentResponse = await axios.get(`/api/assessments/get-questions?assessmentId=${finalAssessmentId}`);
          if (assessmentResponse.data?.success) {
            const assessmentData = assessmentResponse.data.data.assessment;
            const isAptitude = assessmentData?.isAptitudeAssessment || false;
            
            // Update old topics structure if needed (for backward compatibility)
            if (assessmentData.topics && assessmentData.topics.length > 0) {
              setTopics(assessmentData.topics.map((t: any) => t.topic));
              setAvailableQuestionTypes(assessmentData.availableQuestionTypes || QUESTION_TYPES);
            }
          }
        }
        
        // Navigate to Station 2 after successful topic generation
        setHasVisitedConfigureStation(true);
        setCurrentStation(2);
      } else {
        setError("Failed to generate topics");
      }
    } catch (err: any) {
      console.error("Error generating topics:", err);
      setError(err.response?.data?.message || err.message || "Failed to generate topics");
    } finally {
      setLoading(false);
    }
  };

  // ============================================
  // NEW TOPIC V2 HANDLERS
  // ============================================
  
  const handleGenerateTopicsV2 = async () => {
    if (!assessmentId || selectedSkills.length === 0 || !jobDesignation.trim()) {
      setError("Please complete Station 1 first");
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      const response = await axios.post("/api/assessments/generate-topics-v2", {
        assessmentId: assessmentId,
        assessmentTitle: finalTitle.trim() || undefined,
        jobDesignation: jobDesignation.trim(),
        selectedSkills: selectedSkills,
        experienceMin: experienceMin,
        experienceMax: experienceMax,
        experienceMode: experienceMode,
      });
      
      if (response.data?.success) {
        setTopicsV2(response.data.data.topics || []);
        setFullTopicRegenLocked(false);
        setAllQuestionsGenerated(false);
        setHasVisitedConfigureStation(true);
        setCurrentStation(2);
      } else {
        setError("Failed to generate topics");
      }
    } catch (err: any) {
      console.error("Error generating topics:", err);
      setError(err.response?.data?.message || err.message || "Failed to generate topics");
    } finally {
      setLoading(false);
    }
  };
  
  const handleRegenerateTopicV2 = async (topicId: string) => {
    if (!assessmentId || fullTopicRegenLocked) {
      setError("Topic regeneration is locked");
      return;
    }
    
    const topic = topicsV2.find(t => t.id === topicId);
    if (!topic || topic.locked) {
      setError("Topic is locked and cannot be regenerated");
      return;
    }
    
    // Disable regenerate for custom topics once they have generated questions
    // Custom topics are identified by having only one questionRow with questionsCount: 1
    const isCustomTopic = topic.questionRows.length === 1 && 
                          topic.questionRows[0].questionsCount === 1 &&
                          topic.questionRows.some(row => row.questions && row.questions.length > 0 && row.status === "generated");
    
    if (isCustomTopic) {
      setError("Custom topics cannot be regenerated. Use the Preview button on the question row to regenerate individual questions.");
      return;
    }
    
    setGeneratingRowId(topicId); // Reuse this state for topic regeneration
    setError(null);
    
    try {
      const response = await axios.post("/api/assessments/regenerate-topic-v2", {
        assessmentId: assessmentId,
        topicId: topicId,
        assessmentTitle: finalTitle.trim() || undefined,
        jobDesignation: jobDesignation.trim(),
        selectedSkills: selectedSkills,
        experienceMin: experienceMin,
        experienceMax: experienceMax,
        experienceMode: experienceMode,
      });
      
      if (response.data?.success) {
        const updatedTopic = response.data.data.topic;
        setTopicsV2(prev => prev.map(t => t.id === topicId ? updatedTopic : t));
      } else {
        setError("Failed to regenerate topic");
      }
    } catch (err: any) {
      console.error("Error regenerating topic:", err);
      setError(err.response?.data?.message || err.message || "Failed to regenerate topic");
    } finally {
      setGeneratingRowId(null);
    }
  };
  
  // handlePreviewTopicV2 is replaced by handlePreviewRow - keeping for backward compatibility but it's not used
  
  const handlePreviewRow = async (topicId: string, rowId: string) => {
    if (!assessmentId) {
      setError("Assessment ID is required");
      return;
    }
    
    const topic = topicsV2.find(t => t.id === topicId);
    if (!topic) {
      setError("Topic not found");
      return;
    }
    
    const row = topic.questionRows.find(r => r.rowId === rowId);
    if (!row) {
      setError("Question row not found");
      return;
    }
    
    // If questions already exist, just open the preview modal (NO STATE MUTATION)
    if (row.questions && row.questions.length > 0) {
      setPreviewModal({
        isOpen: true,
        topicId: topicId,
        rowId: rowId,
        topic: topic,
        row: row,
        questionIndex: 0,
        editingQuestion: null,
      });
      // Legacy state for backward compatibility
      setSinglePreviewTopic(topic);
      setSinglePreviewRow(row);
      setSinglePreviewQuestionIndex(0);
      setShowSinglePreview(true);
      return;
    }
    
    // If row is locked but has no questions, unlock it (data inconsistency fix)
    // This is the ONLY state update allowed before generation
    if (row.locked && (!row.questions || row.questions.length === 0)) {
      setTopicsV2(prev => prev.map(t => {
        if (t.id === topicId) {
          return {
            ...t,
            questionRows: t.questionRows.map(r => {
              if (r.rowId === rowId) {
                return { ...r, locked: false, status: "pending" };
              }
              return r;
            })
          };
        }
        return t;
      }));
    }
    
    // Validate required fields before generating
    if (!row.questionType || !row.difficulty || !row.questionsCount) {
      setError("Question type, difficulty, and count are required");
      return;
    }
    
    // Generate questions - ONLY update generatingRowId (doesn't affect layout)
    setGeneratingRowId(rowId);
    setError(null);
    
    try {
      const response = await axios.post("/api/assessments/generate-question", {
        assessmentId: assessmentId,
        topicId: topicId,
        rowId: rowId,
        topicLabel: topic.label,
        questionType: row.questionType,
        difficulty: row.difficulty,
        questionsCount: row.questionsCount,
        canUseJudge0: row.canUseJudge0 || false,
        // Include additional context for better generation
        category: topic.category || "technical",
        experienceMin: experienceMin,
        experienceMax: experienceMax,
        experienceMode: experienceMode,
      });
      
      if (response.data?.success) {
        const updatedRow = response.data.data.row;
        const updatedTopic = response.data.data.topic;
        
        // Update state with generated questions (IMMUTABLE UPDATE - NO MUTATION)
        const updatedTopics = topicsV2.map(t => {
          if (t.id === topicId) {
            return {
              ...t,
              locked: updatedTopic.locked || t.locked,
              questionRows: t.questionRows.map(r => {
                if (r.rowId === rowId) {
                  return {
                    ...updatedRow,
                    status: "completed" as const, // Mark as completed after generation
                  };
                }
                return r;
              })
            };
          }
          return t;
        });
        
        setTopicsV2(updatedTopics);
        
        // Immediately update assessment draft with the new topic + question
        if (assessmentId) {
          try {
            await axios.put("/api/assessments/update-draft", {
              assessmentId,
              topics_v2: updatedTopics,
            });
            console.log(`[Custom Topic] Draft updated with generated question for topic ${topicId}, row ${rowId}`);
          } catch (err: any) {
            console.error("Error saving draft after row preview:", err);
            // Don't block UI, just log error
          }
        }
        
        // Open preview modal with generated questions (NO TOPIC STATE MUTATION)
        setPreviewModal({
          isOpen: true,
          topicId: topicId,
          rowId: rowId,
          topic: {
            ...topic,
            locked: updatedTopic.locked || topic.locked,
            questionRows: topic.questionRows.map(r => r.rowId === rowId ? {
              ...updatedRow,
              status: "completed" as const,
            } : r)
          },
          row: {
            ...updatedRow,
            status: "completed" as const,
          },
          questionIndex: 0,
          editingQuestion: null,
        });
        // Legacy state for backward compatibility
        setSinglePreviewTopic({
          ...topic,
          questionRows: topic.questionRows.map(r => r.rowId === rowId ? {
            ...updatedRow,
            status: "completed" as const,
          } : r)
        });
        setSinglePreviewRow({
          ...updatedRow,
          status: "completed" as const,
        });
        setSinglePreviewQuestionIndex(0);
        setShowSinglePreview(true);
      } else {
        setError(response.data?.message || "Failed to generate questions");
      }
    } catch (err: any) {
      console.error("Error generating questions for preview:", err);
      const errorMessage = err.response?.data?.message || err.response?.data?.detail || err.message || "Failed to generate questions";
      setError(errorMessage);
    } finally {
      setGeneratingRowId(null);
    }
  };
  
  // ============================================================================
  // PART 1: PREVIEW ALL BUTTON LOGIC (COMPLETE REWRITE)
  // ============================================================================
  const handlePreviewAllQuestionsV2 = async () => {
    if (!assessmentId) {
      setError("Assessment ID is required");
      return;
    }
    
    setError(null);
    
    // STEP 1: Collect all rows that need generation (only pending rows)
    const rowsToGenerate: Array<{ topicId: string; rowId: string; topic: TopicV2; row: QuestionRow }> = [];
    
    topicsV2.forEach(topic => {
      topic.questionRows.forEach(row => {
        const rowStatus = row.status || "pending";
        
        // Only generate pending rows - skip generated/completed rows
        if (rowStatus === "pending") {
          rowsToGenerate.push({ topicId: topic.id, rowId: row.rowId, topic, row });
        }
      });
    });
    
    // STEP 2: Display existing generated questions immediately
    // Open bulk preview modal IMMEDIATELY with existing questions
    setBulkPreviewTopics([...topicsV2]);
    setBulkPreviewCurrentTopicIndex(0);
    setBulkPreviewCurrentRowIndex(0);
    setBulkPreviewCurrentQuestionIndex(0);
    setShowBulkPreview(true);
    
    // If no rows need generation, just show existing questions
    if (rowsToGenerate.length === 0) {
      setGeneratingAllQuestions(false);
      return;
    }
    
    // STEP 4: For questionRows where status = "pending": generate sequentially
    setGeneratingAllQuestions(true);
    
    const updatedTopics = [...topicsV2];
    
    for (const { topicId, rowId, topic, row } of rowsToGenerate) {
      try {
        const response = await axios.post("/api/assessments/generate-question", {
          assessmentId: assessmentId,
          topicId: topicId,
          rowId: rowId,
          topicLabel: topic.label,
          questionType: row.questionType,
          difficulty: row.difficulty,
          questionsCount: row.questionsCount,
          canUseJudge0: row.canUseJudge0 || false,
          category: topic.category || "technical",
          experienceMin: experienceMin,
          experienceMax: experienceMax,
          experienceMode: experienceMode,
        });
        
        if (response.data?.success) {
          const updatedRow = response.data.data.row;
          const updatedTopic = response.data.data.topic;
          
          // Update local state
          const topicIndex = updatedTopics.findIndex(t => t.id === topicId);
          if (topicIndex !== -1) {
            const rowIndex = updatedTopics[topicIndex].questionRows.findIndex(r => r.rowId === rowId);
            if (rowIndex !== -1) {
              updatedTopics[topicIndex] = {
                ...updatedTopics[topicIndex],
                questionRows: updatedTopics[topicIndex].questionRows.map((r, idx) => 
                  idx === rowIndex ? {
                    ...updatedRow,
                    status: "generated" as const, // Mark as generated
                  } : r
                ),
              };
            }
          }
          
          // STEP 5: Update bulk preview topics LIVE (append newly generated questions)
          const newBulkTopics = updatedTopics.map(t => {
            if (t.id === topicId) {
              return {
                ...t,
                questionRows: t.questionRows.map(r => r.rowId === rowId ? {
                  ...updatedRow,
                  status: "generated" as const,
                } : r),
              };
            }
            return t;
          });
          
          setBulkPreviewTopics([...newBulkTopics]);
          setTopicsV2([...updatedTopics]);
          
          // Update assessment draft
          if (assessmentId) {
            try {
              await axios.put("/api/assessments/update-draft", {
                assessmentId,
                topics_v2: updatedTopics,
              });
            } catch (err: any) {
              console.error("Error saving draft after generation:", err);
            }
          }
        }
      } catch (err: any) {
        console.error(`Error generating questions for row ${rowId}:`, err);
        // Continue with next row - don't block
      }
    }
    
    setGeneratingAllQuestions(false);
    // Modal stays open - user can close manually
  };
  
  // ============================================================================
  // PART 2: REGENERATION LOGIC FOR ALL QUESTION TYPES (INCLUDING CODING)
  // ============================================================================
  const handleRegenerateRow = async (topicId: string, rowId: string) => {
    if (!assessmentId) {
      setError("Assessment ID is required");
      return;
    }
    
    const topic = topicsV2.find(t => t.id === topicId);
    if (!topic) {
      setError("Topic not found");
      return;
    }
    
    const row = topic.questionRows.find(r => r.rowId === rowId);
    if (!row) {
      setError("Question row not found");
      return;
    }
    
    // PART 7: Regeneration disable conditions
    // Check if assessment is locked or attempts started
    if (topic.locked && row.locked) {
      setError("This row is locked and cannot be regenerated");
      return;
    }
    
    setGeneratingRowId(rowId);
    setError(null);
    
    try {
      // PART 2: Regeneration behavior
      // 1. Delete ONLY that row's existing question
      // 2. Set row.status = "pending"
      // 3. Call generate-question API for THIS row ONLY
      // 4. Replace old question object with newly generated content
      // 5. Update UI immediately
      
      // Step 1 & 2: Delete existing questions and set status to pending
      const updatedTopics = topicsV2.map(t => {
        if (t.id === topicId) {
          return {
            ...t,
            questionRows: t.questionRows.map(r => {
              if (r.rowId === rowId) {
                return {
                  ...r,
                  questions: [], // Delete existing questions
                  status: "pending" as const, // Set to pending
                };
              }
              return r;
            }),
          };
        }
        return t;
      });
      setTopicsV2(updatedTopics);
      
      // Step 3: Generate new question for this row ONLY
      const response = await axios.post("/api/assessments/generate-question", {
        assessmentId: assessmentId,
        topicId: topicId,
        rowId: rowId,
        topicLabel: topic.label,
        questionType: row.questionType,
        difficulty: row.difficulty,
        questionsCount: row.questionsCount,
        canUseJudge0: row.canUseJudge0 || false,
        category: topic.category || "technical",
        experienceMin: experienceMin,
        experienceMax: experienceMax,
        experienceMode: experienceMode,
      });
      
      if (response.data?.success) {
        const updatedRow = response.data.data.row;
        const updatedTopic = response.data.data.topic;
        
        // Step 4 & 5: Replace old question and update UI immediately
        const finalTopics = updatedTopics.map(t => {
          if (t.id === topicId) {
            return {
              ...t,
              questionRows: t.questionRows.map(r => {
                if (r.rowId === rowId) {
                  return {
                    ...updatedRow,
                    status: "generated" as const, // Mark as generated after regeneration
                  };
                }
                return r;
              }),
            };
          }
          return t;
        });
        
        setTopicsV2(finalTopics);
        
        // Update draft
        if (assessmentId) {
          try {
            await axios.put("/api/assessments/update-draft", {
              assessmentId,
              topics_v2: finalTopics,
            });
          } catch (err: any) {
            console.error("Error saving draft after regeneration:", err);
          }
        }
        
        // If preview modal is open for this row, update it
        if (previewModal.isOpen && previewModal.topicId === topicId && previewModal.rowId === rowId) {
          setPreviewModal({
            ...previewModal,
            row: {
              ...updatedRow,
              status: "generated" as const,
            },
            questionIndex: 0,
          });
          setSinglePreviewRow({
            ...updatedRow,
            status: "generated" as const,
          });
        }
      } else {
        setError(response.data?.message || "Failed to regenerate question");
      }
    } catch (err: any) {
      console.error("Error regenerating row:", err);
      setError(err.response?.data?.message || err.message || "Failed to regenerate question");
    } finally {
      setGeneratingRowId(null);
    }
  };
  
  const handleRegenerateAllTopicsV2 = async () => {
    if (!assessmentId || fullTopicRegenLocked || allQuestionsGenerated) {
      setError("Topic regeneration is locked after preview");
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      const response = await axios.post("/api/assessments/generate-topics-v2", {
        assessmentId: assessmentId,
        assessmentTitle: finalTitle.trim() || undefined,
        jobDesignation: jobDesignation.trim(),
        selectedSkills: selectedSkills,
        experienceMin: experienceMin,
        experienceMax: experienceMax,
        experienceMode: experienceMode,
      });
      
      if (response.data?.success) {
        setTopicsV2(response.data.data.topics || []);
        setFullTopicRegenLocked(false);
        setAllQuestionsGenerated(false);
      } else {
        setError("Failed to regenerate topics");
      }
    } catch (err: any) {
      console.error("Error regenerating topics:", err);
      setError(err.response?.data?.message || err.message || "Failed to regenerate topics");
    } finally {
      setLoading(false);
    }
  };
  
  const [selectedCategoryForNewTopic, setSelectedCategoryForNewTopic] = useState<"aptitude" | "communication" | "logical_reasoning" | null>(null);
  const [showTechnicalInput, setShowTechnicalInput] = useState(false);

  // Helper function to determine default question type based on category and topic name
  const getDefaultQuestionType = async (
    topicName: string,
    category: "aptitude" | "communication" | "logical_reasoning"
  ): Promise<"MCQ" | "Subjective"> => {
    // For communication, default to Subjective
    if (category === "communication") {
      return "Subjective";
    }
    
    // For aptitude and logical reasoning, try to determine based on semantic meaning
    try {
      const response = await axios.post("/api/assessments/generate-topic-context", {
        topicName: topicName.trim(),
        category: category
      });
      
      if (response.data?.success && response.data?.data?.suggestedQuestionType) {
        return response.data.data.suggestedQuestionType as "MCQ" | "Subjective";
      }
    } catch (err) {
      console.error("Error getting suggested question type:", err);
    }
    
    // Default fallbacks
    if (category === "aptitude") {
      // Check if topic suggests numeric calculations
      const numericKeywords = ["percentage", "ratio", "profit", "loss", "interest", "average", "mixture", "number"];
      const isNumeric = numericKeywords.some(keyword => topicName.toLowerCase().includes(keyword));
      return isNumeric ? "MCQ" : "Subjective";
    }
    
    if (category === "logical_reasoning") {
      // Check if topic suggests puzzles/patterns
      const puzzleKeywords = ["puzzle", "pattern", "sequence", "arrangement", "coding", "decoding"];
      const isPuzzle = puzzleKeywords.some(keyword => topicName.toLowerCase().includes(keyword));
      return isPuzzle ? "MCQ" : "Subjective";
    }
    
    return "MCQ"; // Final fallback
  };

  // Helper function to generate UUID-like ID
  const generateId = () => {
    return `custom-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  };

  // Ref for the custom topic input field
  const customTopicInputRef = useRef<HTMLInputElement>(null);

  // Handler for suggestion clicks - fills input field only
  const handleSuggestionClick = (suggestion: string) => {
    console.log("Suggestion clicked:", suggestion, "Current value:", customTopicInputV2); // Debug log
    
    // Fill the input field with the suggestion
    setCustomTopicInputV2(suggestion);
    
    // Close the suggestion dropdown after a small delay to ensure state update
    setTimeout(() => {
      setShowAiSuggestions(false);
      setAiTopicSuggestions([]);
      
      // Focus the input field after setting the value
      if (customTopicInputRef.current) {
        customTopicInputRef.current.focus();
        // Move cursor to end of input
        const length = suggestion.length;
        customTopicInputRef.current.setSelectionRange(length, length);
      }
    }, 50);
  };

  // Separate handler for soft-skill topics to ensure immediate UI update
  const handleAddSoftSkillTopic = async (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault(); // REQUIRED: Prevent form refresh
      e.stopPropagation(); // Prevent event bubbling
    }
    
    const topicName = customTopicInputV2.trim();
    if (!topicName) return;
    
    // Check for duplicate topic names (case-insensitive)
    const topicExists = topicsV2.some(t => t.label.toLowerCase() === topicName.toLowerCase());
    if (topicExists) {
      setToastMessage("Topic already added.");
      setTimeout(() => setToastMessage(null), 3000);
      return;
    }
    
    // Must have a soft skill category selected
    if (!selectedCategoryForNewTopic) {
      return; // Don't add if no category selected
    }
    
    const finalCategory = selectedCategoryForNewTopic;
    
    // 1. Call backend for context (already working)
    let contextData: any = {};
    let defaultQuestionType: "MCQ" | "Subjective" = "MCQ";
    let contextSummary: string | undefined = undefined;
    
    try {
      const response = await axios.post("/api/assessments/generate-topic-context", {
        topicName: topicName.trim(),
        category: finalCategory
      });
      
      if (response.data?.success && response.data?.data) {
        contextData = response.data.data;
        defaultQuestionType = contextData.suggestedQuestionType || "MCQ";
        contextSummary = contextData.contextSummary;
      }
    } catch (err: any) {
      console.error("Error getting topic context:", err);
      // Fallback to defaults - don't block topic creation
      defaultQuestionType = finalCategory === "communication" ? "Subjective" : "MCQ";
    }
    
    // 2. Build valid topic object
    const newTopic: TopicV2 = {
      id: generateId(),
      label: topicName,
      category: finalCategory,
      locked: false,
      allowedQuestionTypes: ["MCQ", "Subjective"], // REQUIRED: Soft skills only allow MCQ and Subjective
      contextSummary: contextSummary,
      questionRows: [{
        rowId: generateId(),
        questionType: defaultQuestionType,
        difficulty: contextData.difficulty || "Medium",
        questionsCount: 1,
        canUseJudge0: false, // Soft skills never use Judge0
        status: "pending",
        locked: false,
        questions: []
      }],
    };
    
    // 3. INSERT TOPIC INTO STATE IMMEDIATELY (REQUIRES FUNCTIONAL UPDATE)
    // CRITICAL: Use functional update to guarantee immediate UI update
    // Calculate updated topics array for draft save
    const updatedTopics = [...topicsV2, newTopic];
    setTopicsV2((prev) => [...prev, newTopic]);
    
    // 4. CLEAR UI STATE (must happen after state update)
    setCustomTopicInputV2("");
    setShowAiSuggestions(false);
    setAiTopicSuggestions([]);
    setTopicInputValues(prev => ({ ...prev, [newTopic.id]: topicName }));
    
    // 5. Save in draft (async, don't block UI)
    if (assessmentId) {
      axios.put("/api/assessments/update-draft", {
        assessmentId: assessmentId,
        topics_v2: updatedTopics, // Use calculated updated topics array
      }).catch((err) => {
        console.error("Error updating draft:", err);
        setError("Failed to save topic. Please try again.");
      });
    }
  };

  const handleAddCustomTopicV2 = async (isTechnical: boolean = false, topicNameOverride?: string, event?: React.MouseEvent) => {
    if (event) {
      event.preventDefault(); // REQUIRED: Prevent form refresh
      event.stopPropagation(); // Prevent event bubbling
    }
    
    // For soft skills, use the dedicated handler
    if (!isTechnical && selectedCategoryForNewTopic) {
      return handleAddSoftSkillTopic(event);
    }
    
    const topicName = (topicNameOverride || customTopicInputV2.trim());
    if (!topicName) return;
    
    // Check for duplicate topic names (case-insensitive)
    const topicExists = topicsV2.some(t => t.label.toLowerCase() === topicName.toLowerCase());
    if (topicExists) {
      setToastMessage("Topic already added.");
      setTimeout(() => setToastMessage(null), 3000);
      return;
    }
    
    let finalCategory: "aptitude" | "communication" | "logical_reasoning" | "technical";
    let defaultQuestionType: "MCQ" | "Subjective" | "PseudoCode" | "Coding" = "MCQ";
    let canUseJudge0 = false;
    let contextSummary: string | undefined = undefined;
    let codingSupported = false; // NEW: Track coding support from classification
    
    if (isTechnical) {
      finalCategory = "technical";
      
      // Classify technical topic using AI
      try {
        setLoading(true);
        const response = await axios.post("/api/assessments/classify-technical-topic", {
          topic: topicName
        });
        
        if (response.data?.success && response.data?.data) {
          const classification = response.data.data;
          defaultQuestionType = classification.questionType as "MCQ" | "Subjective" | "PseudoCode" | "Coding";
          canUseJudge0 = classification.canUseJudge0 || false;
          codingSupported = classification.coding_supported || false; // NEW: Get coding_supported from classification
          contextSummary = classification.contextExplanation;
          
          // Ensure canUseJudge0 is false if question type is not Coding
          if (defaultQuestionType !== "Coding") {
            canUseJudge0 = false;
          }
        }
      } catch (err: any) {
        console.error("Error classifying technical topic:", err);
        // Fallback to safe defaults
        defaultQuestionType = "MCQ";
        canUseJudge0 = false;
        codingSupported = false;
      } finally {
        setLoading(false);
      }
    } else {
      // This should not happen for soft skills (handled by handleAddSoftSkillTopic)
      return;
    }
    
    // Determine allowed question types based on category and coding support
    // At this point, finalCategory is guaranteed to be "technical" (soft skills return early above)
    
    // Determine allowed question types based on coding support
    // If codingSupported = true: include mcq, subjective, pseudo, coding
    // If codingSupported = false: include only mcq, subjective, pseudo
    const allowedQuestionTypes: string[] = codingSupported 
      ? ["MCQ", "Subjective", "PseudoCode", "Coding"]
      : ["MCQ", "Subjective", "PseudoCode"];
    
    // Check if questions have already been generated (any topic has generated questions)
    const hasGeneratedQuestions = topicsV2.some(topic => 
      topic.questionRows.some(row => 
        row.questions && row.questions.length > 0 && row.status === "generated"
      )
    );
    
    const newTopic: TopicV2 = {
      id: generateId(),
      label: topicName,
      locked: false,
      category: finalCategory,
      contextSummary: contextSummary,
      coding_supported: codingSupported, // NEW: Store coding_supported in topic
      allowedQuestionTypes: allowedQuestionTypes,
      questionRows: [{
        rowId: generateId(),
        questionType: defaultQuestionType,
        difficulty: "Medium",
        questionsCount: 1,
        canUseJudge0: canUseJudge0,
        status: "pending", // Always pending for new custom topics
        locked: false,
        questions: [],
      }],
    };
    
    // If questions have already been generated, this is a custom topic added after generation
    // Mark it as pending and do NOT trigger auto-generation
    if (hasGeneratedQuestions) {
      console.log(`[Custom Topic] Added after questions generated - marking as pending, no auto-generation`);
    }
    
    // CRITICAL: Use functional update to guarantee immediate UI update
    setTopicsV2((prev) => [...prev, newTopic]);
    
    // Save to database immediately (await to ensure it completes)
    if (assessmentId) {
      try {
        await axios.put("/api/assessments/update-draft", {
          assessmentId: assessmentId,
          topics_v2: [...topicsV2, newTopic], // Use updated topics array
        });
        console.log("Custom topic saved to database:", newTopic.id);
      } catch (err: any) {
        console.error("Error updating draft:", err);
        setError("Failed to save topic. Please try again.");
        // Remove the topic from state if save failed
        setTopicsV2((prev) => prev.filter(t => t.id !== newTopic.id));
        return;
      }
    }
    
    setTopicInputValues(prev => ({ ...prev, [newTopic.id]: topicName }));
    setCustomTopicInputV2("");
    setShowTechnicalInput(false);
    setShowAiSuggestions(false);
    setAiTopicSuggestions([]);
  };
  
  const handleRemoveTopicV2 = (topicId: string) => {
    setTopicsV2(prev => prev.filter(t => t.id !== topicId));
  };
  
  // Detect category from topic name (semantic)
  const detectTopicCategory = async (topicName: string): Promise<"aptitude" | "communication" | "logical_reasoning" | "technical"> => {
    if (!topicName || topicName.trim().length < 2) return "technical";
    
    try {
      // Use OpenAI to detect category semantically
      const response = await axios.post("/api/assessments/detect-topic-category", {
        topicName: topicName.trim()
      });
      
      if (response.data?.success && response.data?.data?.category) {
        return response.data.data.category;
      }
    } catch (err) {
      console.error("Error detecting category:", err);
    }
    
    // Fallback: return technical
    return "technical";
  };

  // Fetch topic suggestions (debounced)
  const fetchTopicSuggestions = async (partialInput: string, category: string) => {
    if (!partialInput || partialInput.length < 2) {
      setTopicSuggestions([]);
      return;
    }
    
    setLoadingSuggestions(true);
    try {
      const response = await axios.post("/api/assessments/suggest-topic-contexts", {
        partialInput: partialInput.trim(),
        category: category
      });
      
      if (response.data?.success && response.data?.data?.suggestions) {
        setTopicSuggestions(response.data.data.suggestions);
      } else {
        setTopicSuggestions([]);
      }
    } catch (err: any) {
      console.error("Error fetching suggestions:", err);
      setTopicSuggestions([]);
    } finally {
      setLoadingSuggestions(false);
    }
  };

  // Fetch AI-powered topic suggestions for custom topic input (ONLY for soft skills)
  const fetchAiTopicSuggestions = async (query: string, category: string) => {
    // Only fetch suggestions for soft skills (aptitude, communication, logical_reasoning)
    const softSkillCategories = ["aptitude", "communication", "logical_reasoning"];
    if (!softSkillCategories.includes(category)) {
      setShowAiSuggestions(false);
      setAiTopicSuggestions([]);
      return;
    }
    
    // Clear existing timer
    if (suggestionDebounceTimer) {
      clearTimeout(suggestionDebounceTimer);
    }
    
    // Set new debounced timer (350ms)
    const timer = setTimeout(async () => {
      setLoadingAiSuggestions(true);
      try {
        const response = await axios.post("/api/assessments/suggest-topics", {
          category: category,
          query: query.trim()
        });
        
        if (response.data?.success && response.data?.data?.suggestions) {
          setAiTopicSuggestions(response.data.data.suggestions);
          setShowAiSuggestions(true);
        } else {
          setAiTopicSuggestions([]);
          setShowAiSuggestions(false);
        }
      } catch (err: any) {
        console.error("Error fetching AI topic suggestions:", err);
        setAiTopicSuggestions([]);
        setShowAiSuggestions(false);
      } finally {
        setLoadingAiSuggestions(false);
      }
    }, 350);
    
    setSuggestionDebounceTimer(timer);
  };

  // Generate context summary for a topic
  const generateTopicContext = async (topicId: string, topicName: string, category: string) => {
    if (!topicName || topicName.trim().length === 0) return;
    
    try {
      const response = await axios.post("/api/assessments/generate-topic-context", {
        topicName: topicName.trim(),
        category: category
      });
      
      if (response.data?.success && response.data?.data) {
        const { contextSummary, suggestedQuestionType } = response.data.data;
        
        setTopicsV2(prev => prev.map(t => {
          if (t.id === topicId) {
            const updatedTopic = { ...t, contextSummary, suggestedQuestionType };
            
            // Update first row's question type if suggested
            if (suggestedQuestionType && t.questionRows.length > 0) {
              updatedTopic.questionRows = t.questionRows.map((row, idx) => {
                if (idx === 0) {
                  return { ...row, questionType: suggestedQuestionType };
                }
                return row;
              });
            }
            
            return updatedTopic;
          }
          return t;
        }));
      }
    } catch (err: any) {
      console.error("Error generating context:", err);
    }
  };

  // Handle topic name input with suggestions
  const handleTopicNameChange = (topicId: string, value: string) => {
    // Update input value immediately
    setTopicInputValues(prev => ({ ...prev, [topicId]: value }));
    handleUpdateTopicV2(topicId, "label", value);
    
    // Detect category if not set (async, don't await)
    const topic = topicsV2.find(t => t.id === topicId);
    const specialCategories = ["aptitude", "communication", "logical_reasoning"] as const;
    const isSpecialCategory = topic?.category && specialCategories.includes(topic.category as any);
    
    if (!topic?.category || (topic.category === "technical" || !isSpecialCategory)) {
      detectTopicCategory(value).then(detectedCategory => {
        if (specialCategories.includes(detectedCategory as any)) {
          handleUpdateTopicV2(topicId, "category", detectedCategory);
          
          // Fetch suggestions for non-technical categories
          if (value.length >= 2) {
            setShowingSuggestionsFor(topicId);
            fetchTopicSuggestions(value, detectedCategory);
          }
        }
      });
    } else if (isSpecialCategory && value.length >= 2) {
      // Show suggestions for aptitude/communication/logical_reasoning
      setShowingSuggestionsFor(topicId);
      fetchTopicSuggestions(value, topic.category);
    } else {
      setShowingSuggestionsFor(null);
      setTopicSuggestions([]);
    }
  };

  // REMOVED: Debounced context summary generation useEffect
  // Context is now generated ONLY when user clicks "Add Topic" button
  // This prevents multiple API calls while typing

  // Cleanup suggestion debounce timer on unmount
  useEffect(() => {
    return () => {
      if (suggestionDebounceTimer) {
        clearTimeout(suggestionDebounceTimer);
      }
    };
  }, [suggestionDebounceTimer]);

  const handleUpdateTopicV2 = (topicId: string, field: keyof TopicV2, value: any) => {
    setTopicsV2(prev => prev.map(t => {
      if (t.id === topicId) {
        return { ...t, [field]: value };
      }
      return t;
    }));
  };
  
  const handleAddQuestionRow = async (topicId: string) => {
    if (!assessmentId) {
      setError("Assessment ID is required");
      return;
    }
    
    const topic = topicsV2.find(t => t.id === topicId);
    if (!topic) {
      setError("Topic not found");
      return;
    }
    
    if (topic.locked) {
      setError("Cannot add question row - topic is locked");
      return;
    }
    
    // CRITICAL: For newly added custom topics, ensure they're saved to the database first
    // This prevents 404 errors when the backend can't find the topic
    try {
      console.log("Ensuring topic is saved before adding question row...", { topicId, assessmentId });
      
      // First, ensure the topic exists in the draft by saving it
      const saveResponse = await axios.put("/api/assessments/update-draft", {
        assessmentId: assessmentId,
        topics_v2: topicsV2,
      });
      
      if (!saveResponse.data?.success) {
        console.warn("Draft save response indicates failure:", saveResponse.data);
      }
      
      // Small delay to ensure database write completes
      await new Promise(resolve => setTimeout(resolve, 200));
      
      console.log("Draft saved, now adding question row...");
    } catch (err: any) {
      console.error("Error saving draft before adding question row:", err);
      setError("Failed to save topic. Please try again.");
      return; // Don't proceed if we can't save the topic
    }
    
    try {
      console.log("Calling add-question-row endpoint...", { assessmentId, topicId });
      
      const response = await axios.post("/api/assessments/add-question-row", {
        assessmentId: assessmentId,
        topicId: topicId,
      });
      
      console.log("Add question row response:", response.data);
      
      if (response.data?.success) {
        const updatedTopic = response.data.data.topic;
        const updatedRow = response.data.data.row;
        
        // Update state with the new row
        setTopicsV2(prev => prev.map(t => {
          if (t.id === topicId) {
            return {
              ...t,
              questionRows: [...t.questionRows, updatedRow],
            };
          }
          return t;
        }));
        
        // Update draft with the new row
        const updatedTopics = topicsV2.map(t => {
          if (t.id === topicId) {
            return {
              ...t,
              questionRows: [...t.questionRows, updatedRow],
            };
          }
          return t;
        });
        
        axios.put("/api/assessments/update-draft", {
          assessmentId: assessmentId,
          topics_v2: updatedTopics,
        }).catch((err) => {
          console.error("Error updating draft after adding question row:", err);
        });
      } else {
        setError(response.data?.message || "Failed to add question row");
      }
    } catch (err: any) {
      console.error("Error adding question row:", err);
      const errorMessage = err.response?.data?.message || err.response?.data?.detail || err.message || "Failed to add question row";
      setError(errorMessage);
      
      // If it's a 404, provide more helpful error message
      if (err.response?.status === 404) {
        setError(`Topic not found in database. Please refresh the page and try again. Error: ${errorMessage}`);
      }
    }
  };
  
  // Handler to remove a question from Review Questions page
  const handleRemoveQuestionInReview = async (topicId: string, rowId: string, questionIndex: number) => {
    if (!assessmentId) return;
    
    try {
      const topic = topicsV2.find(t => t.id === topicId);
      if (!topic) return;
      
      const row = topic.questionRows.find(r => r.rowId === rowId);
      if (!row || !row.questions) return;
      
      // Remove the question from the array
      const updatedQuestions = row.questions.filter((_, idx) => idx !== questionIndex);
      
      // Update state
      setTopicsV2(prev => prev.map(t => {
        if (t.id === topicId) {
          return {
            ...t,
            questionRows: t.questionRows.map(r => {
              if (r.rowId === rowId) {
                return {
                  ...r,
                  questions: updatedQuestions,
                };
              }
              return r;
            })
          };
        }
        return t;
      }));
      
      // Update draft
      const updatedTopics = topicsV2.map(t => {
        if (t.id === topicId) {
          return {
            ...t,
            questionRows: t.questionRows.map(r => {
              if (r.rowId === rowId) {
                return {
                  ...r,
                  questions: updatedQuestions,
                };
              }
              return r;
            })
          };
        }
        return t;
      });
      
      await axios.put("/api/assessments/update-draft", {
        assessmentId: assessmentId,
        topics_v2: updatedTopics,
      });
    } catch (err: any) {
      console.error("Error removing question:", err);
      setError(err.response?.data?.message || err.message || "Failed to remove question");
    }
  };
  
  const handleRemoveQuestionRow = async (topicId: string, rowId: string) => {
    if (!assessmentId) return;
    
    const topic = topicsV2.find(t => t.id === topicId);
    if (!topic) return;
    
    const row = topic.questionRows.find(r => r.rowId === rowId);
    if (!row || row.locked) return;
    
    if (topic.questionRows.length <= 1) {
      setError("Cannot remove the last question row");
      return;
    }
    
    try {
      const response = await axios.post("/api/assessments/remove-question-row", {
        assessmentId: assessmentId,
        topicId: topicId,
        rowId: rowId,
      });
      
      if (response.data?.success) {
        const updatedTopic = response.data.data.topic;
        setTopicsV2(prev => prev.map(t => t.id === topicId ? updatedTopic : t));
      }
    } catch (err: any) {
      console.error("Error removing question row:", err);
      setError(err.response?.data?.message || err.message || "Failed to remove question row");
    }
  };
  
  const handleUpdateRow = (topicId: string, rowId: string, field: keyof QuestionRow, value: any) => {
    setTopicsV2(prev => prev.map(t => {
      if (t.id === topicId) {
        const updatedRows = t.questionRows.map(r => {
          if (r.rowId === rowId) {
            const updated = { ...r, [field]: value };
            // Ensure canUseJudge0 is only true for Coding
            if (field === "questionType") {
              if (value === "Coding") {
                // Only allow Coding if canUseJudge0 is true
                if (!updated.canUseJudge0) {
                  return r; // Revert
                }
              } else {
                updated.canUseJudge0 = false;
              }
            }
            return updated;
          }
          return r;
        });
        return { ...t, questionRows: updatedRows };
      }
      return t;
    }));
  };

  const handleAddQuestionType = (topicIndex: number) => {
    const updated = [...topicConfigs];
    const topic = updated[topicIndex];
    const isAptitude = topic.isAptitude || false;
    
    // Get available question types
    let availableTypes = QUESTION_TYPES;
    if (isAptitude && topic.subTopic && topic.aptitudeStructure) {
      availableTypes = topic.aptitudeStructure.subTopics[topic.subTopic] || [];
    }
    
    // Find a question type that's not already used
    const usedTypes = topic.questionTypeConfigs.map(qtc => qtc.questionType);
    const newType = availableTypes.find(type => !usedTypes.includes(type)) || availableTypes[0] || "MCQ";
    
    // Create new question type config
    const newConfig: QuestionTypeConfig = {
      questionType: newType,
      difficulty: "Medium",
      numQuestions: 1,
    };
    
    // Auto-set language if coding
    if (newType === "coding") {
      newConfig.language = getLanguageFromTopic(topic.topic);
      newConfig.judge0_enabled = true;
    }
    
    topic.questionTypeConfigs.push(newConfig);
    setTopicConfigs(updated);
  };

  const handleRemoveQuestionType = (topicIndex: number, configIndex: number) => {
    const updated = [...topicConfigs];
    const topic = updated[topicIndex];
    
    // Don't allow removing the last question type
    if (topic.questionTypeConfigs.length <= 1) {
      setError("Each topic must have at least one question type");
      return;
    }
    
    topic.questionTypeConfigs.splice(configIndex, 1);
    setTopicConfigs(updated);
  };

  const handleUpdateQuestionTypeConfig = (
    topicIndex: number,
    configIndex: number,
    field: keyof QuestionTypeConfig,
    value: any
  ) => {
    const updated = [...topicConfigs];
    const topic = updated[topicIndex];
    const config = topic.questionTypeConfigs[configIndex];
    
    // Update the field
    (config as any)[field] = value;
    
    // Auto-set language when question type changes to "coding"
    if (field === "questionType") {
      if (value === "coding") {
        // Only allow "coding" if topic supports coding
        const topicObj = topicConfigs[topicIndex];
        if (topicObj && topicObj.coding_supported === false) {
          // Topic doesn't support coding, revert to previous value or use a safe default
          const previousValue = config.questionType;
          (config as any).questionType = previousValue || "Subjective";
          return; // Don't update if coding is not supported
        }
        config.language = getLanguageFromTopic(topic.topic);
        config.judge0_enabled = true;
      } else {
        config.language = undefined;
        config.judge0_enabled = undefined;
      }
    }
    
    setTopicConfigs(updated);
  };

  const handleUpdateTopicConfig = (index: number, field: keyof Topic, value: any) => {
    const updated = [...topicConfigs];
    updated[index] = { ...updated[index], [field]: value };
    
    // For aptitude topics: when sub-topic changes, update available question types
    if (field === "subTopic" && updated[index].isAptitude && updated[index].aptitudeStructure) {
      const subTopic = value;
      const questionTypes = updated[index].aptitudeStructure?.subTopics[subTopic] || [];
      // Update all question type configs to use available types
      if (questionTypes.length > 0) {
        updated[index].questionTypeConfigs.forEach((qtc, idx) => {
          if (!questionTypes.includes(qtc.questionType)) {
            qtc.questionType = questionTypes[0];
          }
        });
      }
    }
    
    // When topic name changes, update language for coding questions
    if (field === "topic") {
      updated[index].questionTypeConfigs.forEach(qtc => {
        if (qtc.questionType === "coding" && !qtc.language) {
          qtc.language = getLanguageFromTopic(value);
          qtc.judge0_enabled = true;
        }
      });
    }
    
    setTopicConfigs(updated);
  };

  // Helper function to get question types for a given aptitude topic and sub-topic
  const getAptitudeQuestionTypes = (config: Topic): string[] => {
    if (!config.isAptitude || !config.aptitudeStructure || !config.subTopic) {
      return availableQuestionTypes;
    }
    return config.aptitudeStructure.subTopics[config.subTopic] || [];
  };


  // Auto-detect language from topic/skill name
  const getLanguageFromTopic = (topic: string): string => {
    if (!topic) return "71"; // Default to Python
    
    const topicLower = topic.toLowerCase();
    
    // Language-specific keywords
    const languageMap: { [key: string]: string } = {
      // Python
      "python": "71",
      "django": "71",
      "flask": "71",
      "pandas": "71",
      "numpy": "71",
      "tensorflow": "71",
      "pytorch": "71",
      "scikit": "71",
      "jupyter": "71",
      
      // JavaScript/TypeScript
      "javascript": "63",
      "js": "63",
      "node": "63",
      "nodejs": "63",
      "react": "63",
      "vue": "63",
      "angular": "63",
      "express": "63",
      "typescript": "74",
      "ts": "74",
      "next": "63",
      "nextjs": "63",
      
      // Java
      "java": "62",
      "spring": "62",
      "hibernate": "62",
      "maven": "62",
      "gradle": "62",
      
      // C/C++
      "c++": "54",
      "cpp": "54",
      "cplusplus": "54",
      "c": "50",
      
      // C#
      "c#": "51",
      "csharp": "51",
      ".net": "51",
      "dotnet": "51",
      "asp.net": "51",
      
      // Go
      "go": "60",
      "golang": "60",
      
      // Rust
      "rust": "73",
      
      // Kotlin
      "kotlin": "78",
      "android": "78",
      
      // PHP
      "php": "68",
      "laravel": "68",
      "symfony": "68",
      
      // Ruby
      "ruby": "72",
      "rails": "72",
      "ruby on rails": "72",
      
      // Swift
      "swift": "83",
      "ios": "83",
      
      // SQL
      "sql": "82",
      "mysql": "82",
      "postgresql": "82",
      "mongodb": "82",
      "database": "82",
    };
    
    // Check for exact matches first
    for (const [keyword, langId] of Object.entries(languageMap)) {
      if (topicLower.includes(keyword)) {
        return langId;
      }
    }
    
    // Default to Python for general programming topics
    return "71";
  };

  const handleRemoveTopic = async (index: number) => {
    const topicToRemove = topicConfigs[index];
    if (!topicToRemove) return;

    // Remove from local state first
    const updatedConfigs = topicConfigs.filter((_, i) => i !== index);
    setTopicConfigs(updatedConfigs);

    // If assessmentId exists, also remove from database
    if (assessmentId && topicToRemove.topic) {
      try {
        await axios.delete("/api/assessments/remove-topic", {
          data: {
            assessmentId: assessmentId,
            topicsToRemove: [topicToRemove.topic],
          },
        });
        // Also update topics list
        setTopics(topics.filter(t => t !== topicToRemove.topic));
      } catch (err: any) {
        console.error("Error removing topic from database:", err);
        // Revert local state change if database update fails
        setTopicConfigs(topicConfigs);
        setError(err.response?.data?.message || "Failed to remove topic from database");
      }
    } else {
      // If no assessmentId, just update local topics list
      setTopics(topics.filter(t => t !== topicToRemove.topic));
    }
  };

  const handleAddCustomTopic = async () => {
    if (!customTopicInput.trim()) {
      setError("Please enter a topic name");
      return;
    }

    const topicName = customTopicInput.trim();
    
    // Check if topic already exists
    if (topicConfigs.some(t => t.topic.toLowerCase() === topicName.toLowerCase())) {
      setError("Topic already exists");
      return;
    }

    setError(null);
    setLoading(true);

    try {
      // Regenerate topic details from backend
      const response = await axios.post("/api/assessments/regenerate-single-topic", {
        topic: topicName,
      });

      if (response.data?.success) {
        const data = response.data.data;
        const questionType = data.questionType || "MCQ";
        const isCoding = questionType === "coding";
        const autoLanguage = isCoding ? getLanguageFromTopic(topicName) : undefined;

        const newTopic: Topic = {
          topic: topicName,
          questionTypeConfigs: [{
            questionType: questionType,
            difficulty: "Medium",
            numQuestions: 1,
            language: autoLanguage,
            judge0_enabled: isCoding ? true : undefined,
          }],
          isAptitude: false,
          coding_supported: data.coding_supported !== undefined ? data.coding_supported : (isCoding ? true : undefined),
        };

        setTopicConfigs([...topicConfigs, newTopic]);
        setCustomTopicInput("");
        
        // Clear preview questions so that preview will regenerate with the new topic
        // This ensures questions are generated for the newly added topic when preview is clicked
        setPreviewQuestions([]);
        setQuestions([]);
        console.log(`[Add Custom Topic] Cleared preview questions - will regenerate on next preview click to include new topic: ${topicName}`);
      } else {
        setError("Failed to add custom topic");
      }
    } catch (err: any) {
      console.error("Error adding custom topic:", err);
      setError(err.response?.data?.message || err.message || "Failed to add custom topic");
    } finally {
      setLoading(false);
    }
  };

  const handleResetTopics = () => {
    if (originalTopicConfigsRef.current.length > 0) {
      setTopicConfigs(JSON.parse(JSON.stringify(originalTopicConfigsRef.current)));
      setError(null);
    }
  };

  const handleRegenerateAllTopics = async () => {
    if (!assessmentId) {
      setError("Assessment ID not found. Please generate topics first.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // First, ensure we have skills - fetch from assessment if not in state
      let skillsToUse = selectedSkills;
      if (!skillsToUse || skillsToUse.length === 0) {
        try {
          const assessmentResponse = await axios.get(`/api/assessments/get-questions?assessmentId=${assessmentId}`);
          if (assessmentResponse.data?.success) {
            const assessment = assessmentResponse.data.data.assessment || assessmentResponse.data.data;
            if (assessment.selectedSkills && assessment.selectedSkills.length > 0) {
              skillsToUse = assessment.selectedSkills;
              setSelectedSkills(assessment.selectedSkills); // Update state for future use
            }
          }
        } catch (err) {
          console.error("Error fetching assessment skills:", err);
        }
      }
      
      if (!skillsToUse || skillsToUse.length === 0) {
        setError("No skills found in assessment. Please go back to Station 1 and select skills first.");
        setLoading(false);
        return;
      }

      // First, delete all questions from all topics
      await axios.post("/api/assessments/delete-topic-questions", {
        assessmentId: assessmentId,
        // No topic specified = delete all
      });
      
      // Clear questions state immediately
      setQuestions([]);
      setPreviewQuestions([]);
      
      // Clear topic configs immediately to show loading state
      setTopicConfigs([]);
      setTopics([]);
      
      console.log(`[Regenerate Topics] Starting regeneration for assessment ${assessmentId}`);
      
      // Then regenerate topics - this will update the existing assessment
      // The handleGenerateTopics function will handle updating the existing assessment
      // by calling create-from-job-designation which will replace all topics
      await handleGenerateTopics();
      
      console.log(`[Regenerate Topics] Regeneration completed for assessment ${assessmentId}`);
    } catch (err: any) {
      console.error("Error regenerating topics:", err);
      setError(err.response?.data?.message || err.message || "Failed to regenerate topics");
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerateSingleTopic = async (topicIndex: number) => {
    const topic = topicConfigs[topicIndex];
    if (!topic || topic.isAptitude) {
      return; // Don't regenerate aptitude topics
    }

    if (!assessmentId) {
      setError("Assessment ID not found. Please generate topics first.");
      return;
    }

    setRegeneratingTopicIndex(topicIndex);
    setError(null);

    try {
      // First, ensure we have skills - always fetch from assessment to ensure we have the latest
      let skillsToUse = selectedSkills;
      
      // Always try to fetch from assessment to ensure we have the latest skills
      try {
        const assessmentResponse = await axios.get(`/api/assessments/get-questions?assessmentId=${assessmentId}`);
        if (assessmentResponse.data?.success) {
          const assessment = assessmentResponse.data.data.assessment || assessmentResponse.data.data;
          if (assessment.selectedSkills && assessment.selectedSkills.length > 0) {
            skillsToUse = assessment.selectedSkills;
            setSelectedSkills(assessment.selectedSkills); // Update state for future use
          }
        }
      } catch (err) {
        console.error("Error fetching assessment skills:", err);
        // If fetch fails, try to use skills from state
        if (!skillsToUse || skillsToUse.length === 0) {
          setError("Failed to fetch skills from assessment. Please go back to Station 1 and ensure skills are selected.");
          setRegeneratingTopicIndex(null);
          return;
        }
      }
      
      if (!skillsToUse || skillsToUse.length === 0) {
        setError("No skills found in assessment. Please go back to Station 1 and select skills first.");
        setRegeneratingTopicIndex(null);
        return;
      }
      
      console.log("Using skills for topic regeneration:", skillsToUse);

      // First, delete questions for this specific topic
      await axios.post("/api/assessments/delete-topic-questions", {
        assessmentId: assessmentId,
        topic: topic.topic,
      });
      
      // Clear preview questions for this topic (they're no longer valid after regeneration)
      setPreviewQuestions((prev) => {
        const filtered = prev.filter((q: any) => q.topic !== topic.topic);
        console.log(`[Preview] Cleared preview questions for topic '${topic.topic}'. Remaining: ${filtered.length}`);
        return filtered;
      });

      // Then regenerate the topic (get new question type and coding support)
      const response = await axios.post("/api/assessments/regenerate-single-topic", {
        topic: topic.topic,
        assessmentId: assessmentId,
      });

      if (response.data?.success) {
        const data = response.data.data;
        const newTopicName = data.topic || topic.topic; // Use new topic name if provided
        const questionType = data.questionType || "MCQ";
        const isCoding = questionType === "coding";
        const autoLanguage = isCoding ? getLanguageFromTopic(newTopicName) : undefined; // Use new topic name for language detection

        const updated = [...topicConfigs];
        updated[topicIndex] = {
          ...updated[topicIndex],
          topic: newTopicName, // Update topic name
          coding_supported: data.coding_supported !== undefined ? data.coding_supported : (isCoding ? true : undefined),
        };

        // Update the first question type config
        if (updated[topicIndex].questionTypeConfigs.length > 0) {
          updated[topicIndex].questionTypeConfigs[0] = {
            ...updated[topicIndex].questionTypeConfigs[0],
            questionType: questionType,
            language: autoLanguage,
            judge0_enabled: isCoding ? true : undefined,
          };
        } else {
          updated[topicIndex].questionTypeConfigs = [{
            questionType: questionType,
            difficulty: "Medium",
            numQuestions: 1,
            language: autoLanguage,
            judge0_enabled: isCoding ? true : undefined,
          }];
        }

        setTopicConfigs(updated);

        // CRITICAL: Reset regenerating state immediately after topic regeneration succeeds
        // Question generation will happen in background but button should show normal state
        setRegeneratingTopicIndex(null);

        // Generate questions only for this regenerated topic (in background)
        const topicConfig = updated[topicIndex];
        
        // Ensure we have valid question type configs
        if (!topicConfig.questionTypeConfigs || topicConfig.questionTypeConfigs.length === 0) {
          setError("No question type configuration found for this topic");
          return;
        }
        
        const flattenedTopic = topicConfig.questionTypeConfigs
          .filter((qtc) => qtc.numQuestions > 0) // Only include configs with questions
          .map((qtc) => ({
            topic: topicConfig.topic,
            questionType: qtc.questionType || "MCQ",
            difficulty: qtc.difficulty || "Medium",
            numQuestions: qtc.numQuestions || 1,
            isAptitude: topicConfig.isAptitude || false,
            subTopic: topicConfig.subTopic || undefined,
            language: qtc.language || undefined,
            judge0_enabled: qtc.judge0_enabled !== undefined ? qtc.judge0_enabled : undefined,
          }));

        // Only generate if we have valid topics with questions
        if (flattenedTopic.length === 0) {
          setError("No valid question configurations found for this topic");
          return;
        }

        // Use the skills we already fetched at the beginning
        // skillsToUse is already set from the beginning of the function

        // Generate questions for this topic only (async, don't block UI)
        try {
          const generateResponse = await axios.post("/api/assessments/generate-questions-from-config", {
            assessmentId,
            skill: skillsToUse.join(", "),
            topics: flattenedTopic,
          });

          if (generateResponse.data?.success) {
            // Update questions state - remove old questions for this topic and add new ones
            const newQuestions: any[] = [];
            
            // Collect all questions from all topics in the response
            if (generateResponse.data.data.topics && Array.isArray(generateResponse.data.data.topics)) {
              generateResponse.data.data.topics.forEach((t: any) => {
                if (t.questions && Array.isArray(t.questions) && t.questions.length > 0) {
                  // Ensure each question has the correct topic name (use newTopicName in case it changed)
                  const questionsWithTopic = t.questions.map((q: any) => ({
                    ...q,
                    topic: newTopicName, // Ensure all questions have the new topic name
                  }));
                  newQuestions.push(...questionsWithTopic);
                }
              });
            }

            console.log(`[Topic Regeneration] Backend returned ${newQuestions.length} new questions for topic '${newTopicName}'`);
            console.log(`[Topic Regeneration] Response structure:`, {
              hasData: !!generateResponse.data.data,
              hasTopics: !!generateResponse.data.data.topics,
              topicsCount: generateResponse.data.data.topics?.length || 0,
              totalQuestions: generateResponse.data.data.totalQuestions || 0,
            });
            console.log(`[Topic Regeneration] New questions breakdown:`, newQuestions.map((q: any, idx: number) => ({
              index: idx,
              topic: q.topic,
              type: q.type,
              questionPreview: q.questionText?.substring(0, 30) || q.question?.substring(0, 30) || 'N/A'
            })));

            if (newQuestions.length === 0) {
              console.warn(`[Topic Regeneration] No questions were generated for topic '${newTopicName}'. Check backend response.`);
              setError("No questions were generated. Please try again.");
              return;
            }

            // Filter out old questions for both old and new topic names (in case topic name changed)
            const updatedQuestions = questions.filter((q: any) => q.topic !== topic.topic && q.topic !== newTopicName);
            setQuestions([...updatedQuestions, ...newQuestions]);
            
            // Also update previewQuestions - remove old and add new for this topic only
            // Use functional update to ensure we have the latest state
            setPreviewQuestions((prev) => {
              const filtered = prev.filter((q: any) => q.topic !== topic.topic && q.topic !== newTopicName);
              const updated = [...filtered, ...newQuestions];
              console.log(`[Topic Regeneration] Preview questions update: removed ${prev.length - filtered.length} old questions, added ${newQuestions.length} new questions. Total preview questions: ${updated.length} (was ${prev.length})`);
              console.log(`[Topic Regeneration] Updated preview questions:`, updated.map((q: any, idx: number) => ({
                index: idx,
                topic: q.topic,
                type: q.type,
                questionPreview: q.questionText?.substring(0, 30) || q.question?.substring(0, 30) || 'N/A'
              })));
              return updated;
            });
            
            // Reset preview index if it's out of bounds after update
            setTimeout(() => {
              setPreviewQuestions((current) => {
                if (currentPreviewIndex >= current.length && current.length > 0) {
                  console.log(`[Topic Regeneration] Adjusting preview index: ${currentPreviewIndex} -> ${current.length - 1}`);
                  setCurrentPreviewIndex(current.length - 1);
                }
                return current; // Return unchanged to avoid double update
              });
            }, 100);
            
            console.log(`[Topic Regeneration] Successfully updated: Generated ${newQuestions.length} new questions for topic '${newTopicName}'. Removed old questions for '${topic.topic}'.`);
          } else {
            console.error(`[Topic Regeneration] Backend response was not successful:`, generateResponse.data);
            setError("Failed to generate questions. Please try again.");
          }
        } catch (genErr: any) {
          // Log error but don't block - topic regeneration already succeeded
          console.error("Error generating questions after topic regeneration:", genErr);
          setError("Topic regenerated successfully, but failed to generate questions. You can generate questions later.");
        }
      } else {
        setError("Failed to regenerate topic");
      }
    } catch (err: any) {
      console.error("Error regenerating topic:", err);
      setError(err.response?.data?.message || err.message || "Failed to regenerate topic");
    } finally {
      setRegeneratingTopicIndex(null);
    }
  };

  const handleNextToStation2 = async () => {
    // If topics haven't been generated yet, generate them first
    if (topics.length === 0) {
      if (selectedSkills.length === 0) {
        setError("Please select at least one skill to assess");
        return;
      }
      
      setLoading(true);
      setError(null);

      try {
        const response = await axios.post("/api/assessments/create-from-job-designation", {
          jobDesignation: jobDesignation.trim(),
          selectedSkills: selectedSkills,
          experienceMin: experienceMin.toString(),
          experienceMax: experienceMax.toString(),
          experienceMode: experienceMode,
        });

        if (response.data?.success) {
          const data = response.data.data;
          const isAptitude = data.assessment?.isAptitudeAssessment || false;
          setTopics(data.assessment.topics.map((t: any) => t.topic));
          setAvailableQuestionTypes(data.questionTypes || QUESTION_TYPES);
          const newAssessmentId = data.assessment._id || data.assessment.id;
          setAssessmentId(newAssessmentId);
          
          // Note: Draft will be saved automatically when navigating away (browser back or Back to Dashboard button)
          
          const newTopicConfigs = data.assessment.topics.map((t: any) => {
            // Check if this specific topic is an aptitude topic
            const isTopicAptitude = t.isAptitude === true || (isAptitude && t.category === "aptitude");
            
            if (isTopicAptitude) {
              // Handle aptitude topic
              const availableSubTopics = t.availableSubTopics || t.subTopics || [];
              const defaultSubTopic = availableSubTopics.length > 0 ? availableSubTopics[0] : undefined;
              const selectedSubTopic = t.subTopic || defaultSubTopic;
              
              // Get question type based on selected sub-topic
              let defaultQuestionType = "MCQ"; // Default for aptitude
              if (selectedSubTopic && t.aptitudeStructure?.subTopics?.[selectedSubTopic]) {
                const questionTypes = t.aptitudeStructure.subTopics[selectedSubTopic];
                defaultQuestionType = questionTypes.length > 0 ? questionTypes[0] : "MCQ";
              }
              
              return {
                topic: t.topic,
                questionTypeConfigs: [{
                questionType: defaultQuestionType,
                difficulty: t.difficulty || "Medium",
                numQuestions: 1,
                }],
                isAptitude: true,
                subTopic: selectedSubTopic,
                aptitudeStructure: t.aptitudeStructure || undefined,
                availableSubTopics: availableSubTopics,
              };
            } else {
              // Handle technical topic - use topic-specific question type from backend
              // The backend now determines question type based on topic context
              const questionType = t.questionTypes?.[0] || "MCQ";
              const isCoding = questionType === "coding";
              const autoLanguage = isCoding ? getLanguageFromTopic(t.topic) : undefined;
              
              return {
                topic: t.topic,
                questionTypeConfigs: [{
                  questionType: questionType,
                difficulty: t.difficulty || "Medium",
                numQuestions: 1,
                  language: autoLanguage,
                  judge0_enabled: isCoding ? true : undefined,
                }],
                isAptitude: false,
                coding_supported: t.coding_supported !== undefined ? t.coding_supported : (isCoding ? true : undefined),
              };
            }
          });
          setTopicConfigs(newTopicConfigs);
          // After generating topics, navigate to Station 2
          setError(null);
          setHasVisitedConfigureStation(true);
          if (!hasVisitedReviewStation) {
            originalTopicConfigsRef.current = JSON.parse(JSON.stringify(newTopicConfigs));
          }
          setCurrentStation(2);
        } else {
          setError("Failed to generate topics");
        }
      } catch (err: any) {
        console.error("Error generating topics:", err);
        setError(err.response?.data?.message || err.message || "Failed to generate topics");
      } finally {
        setLoading(false);
      }
    } else {
      // Topics already generated, just navigate
      setError(null);
      setHasVisitedConfigureStation(true);
      if (!hasVisitedReviewStation) {
        originalTopicConfigsRef.current = JSON.parse(JSON.stringify(topicConfigs));
      }
      setCurrentStation(2);
    }
  };

  const handleNextToStation3 = async () => {
    if (topicConfigs.length === 0) {
      setError("Please configure at least one topic");
      return;
    }

    // Filter out topics with empty names
    const validConfigs = topicConfigs.filter((tc) => tc.topic.trim() !== "");
    if (validConfigs.length === 0) {
      setError("Please enter at least one topic name");
      return;
    }

    // Validate configurations - for aptitude topics, sub-topic is required
    // Each topic must have at least one valid question type config
    const invalidConfigs = validConfigs.filter(
      (tc) => {
        // Check if topic has at least one question type config
        if (!tc.questionTypeConfigs || tc.questionTypeConfigs.length === 0) {
          return true;
        }
        
        // Check if all question type configs are valid
        const invalidConfigs = tc.questionTypeConfigs.filter(
          (qtc) => !qtc.questionType || !qtc.difficulty || qtc.numQuestions < 1
        );
        if (invalidConfigs.length > 0) {
          return true;
        }
        
        // For aptitude topics, sub-topic is required
        const aptitudeInvalid = tc.isAptitude && !tc.subTopic;
        return aptitudeInvalid;
      }
    );
    if (invalidConfigs.length > 0) {
      setError("Please complete all configurations for all topics. Each topic must have at least one question type with valid difficulty and number of questions. Aptitude topics require a sub-topic selection.");
      return;
    }

    // Update topicConfigs to only include valid topics
    setTopicConfigs(validConfigs);

    // Transform topics to flat structure for API (one entry per question type config)
    const flattenedTopics = validConfigs.flatMap((tc) => {
      return tc.questionTypeConfigs.map((qtc) => ({
        topic: tc.topic,
        questionType: qtc.questionType,
        difficulty: qtc.difficulty,
        numQuestions: qtc.numQuestions,
        isAptitude: tc.isAptitude,
        subTopic: tc.subTopic,
        language: qtc.language,
        judge0_enabled: qtc.judge0_enabled,
      }));
    });

    // Check if we need to regenerate questions
    // Only regenerate if:
    // Check if we have preview questions that can be used instead of regenerating
    const hasPreviewQuestions = previewQuestions.length > 0;
    
    // 1. User has visited Review station (came back from Review)
    // 2. Edit mode was active
    // 3. Changes were made (compare with original configs)
    const shouldRegenerate = hasVisitedReviewStation && 
      JSON.stringify(validConfigs) !== JSON.stringify(originalTopicConfigsRef.current);

    // If we have preview questions and no changes, use them instead of regenerating
    if (hasPreviewQuestions && !shouldRegenerate && questions.length === 0) {
      console.log(`[Review] Using ${previewQuestions.length} preview questions for review page`);
      setQuestions(previewQuestions);
      setCurrentStation(3);
      return;
    }

    if (shouldRegenerate) {
      setGenerating(true);
      setError(null);

      try {
        const response = await axios.post("/api/assessments/generate-questions-from-config", {
          assessmentId,
          skill: selectedSkills.join(", "),
          topics: flattenedTopics,
        });

        if (response.data?.success) {
          const allQuestions: any[] = [];
          response.data.data.topics.forEach((topic: any) => {
            if (topic.questions && topic.questions.length > 0) {
              allQuestions.push(...topic.questions);
            }
          });
          setQuestions(allQuestions);
          // Update original configs after regeneration
          originalTopicConfigsRef.current = JSON.parse(JSON.stringify(validConfigs));
          setHasVisitedReviewStation(false);
          setCurrentStation(3);
        } else {
          setError("Failed to generate questions");
        }
      } catch (err: any) {
        console.error("Error generating questions:", err);
        setError(err.response?.data?.message || err.message || "Failed to generate questions");
      } finally {
        setGenerating(false);
      }
    } else {
      // No regeneration needed
      if (!hasVisitedReviewStation) {
        // First time generating, save original configs
        originalTopicConfigsRef.current = JSON.parse(JSON.stringify(validConfigs));
        setGenerating(true);
        setError(null);

        try {
          const response = await axios.post("/api/assessments/generate-questions-from-config", {
            assessmentId,
            skill: selectedSkills.join(", "),
            topics: flattenedTopics,
          });

          if (response.data?.success) {
            const allQuestions: any[] = [];
            response.data.data.topics.forEach((topic: any) => {
              if (topic.questions && topic.questions.length > 0) {
                allQuestions.push(...topic.questions);
              }
            });
            setQuestions(allQuestions);
            setCurrentStation(3);
          } else {
            setError("Failed to generate questions");
          }
        } catch (err: any) {
          console.error("Error generating questions:", err);
          setError(err.response?.data?.message || err.message || "Failed to generate questions");
        } finally {
          setGenerating(false);
        }
      } else {
        // Returning from Review without changes, just proceed
        setCurrentStation(3);
      }
    }
  };

  const handlePreviewQuestions = async () => {
    if (topicConfigs.length === 0) {
      setError("Please configure at least one topic");
      return;
    }

    // Ensure assessmentId exists - if not, try to get it from URL (edit mode) or show error
    let currentAssessmentId = assessmentId;
    if (!currentAssessmentId && isEditMode && id && typeof id === 'string') {
      currentAssessmentId = id;
      setAssessmentId(id);
    }
    
    if (!currentAssessmentId) {
      setError("Assessment not found. Please generate topics first.");
      return;
    }

    // Filter out topics with empty names
    const validConfigs = topicConfigs.filter((tc) => tc.topic.trim() !== "");
    if (validConfigs.length === 0) {
      setError("Please enter at least one topic name");
      return;
    }

    // Validate configurations
    const invalidConfigs = validConfigs.filter(
      (tc) => {
        if (!tc.questionTypeConfigs || tc.questionTypeConfigs.length === 0) {
          return true;
        }
        const invalidConfigs = tc.questionTypeConfigs.filter(
          (qtc) => !qtc.questionType || !qtc.difficulty || qtc.numQuestions < 1
        );
        if (invalidConfigs.length > 0) {
          return true;
        }
        const aptitudeInvalid = tc.isAptitude && !tc.subTopic;
        return aptitudeInvalid;
      }
    );
    if (invalidConfigs.length > 0) {
      setError("Please complete all configurations for all topics.");
      return;
    }

    // If generation is in progress, just reopen the modal to show progress
    if (previewGenerating) {
      setShowPreviewModal(true);
      return;
    }

    // Check if preview questions already exist in state
    // If topics have changed (e.g., new topic added), we need to regenerate
    if (previewQuestions.length > 0) {
      // Count expected questions based on current topicConfigs
      const expectedQuestionCount = validConfigs.reduce((sum, tc) => {
        return sum + (tc.questionTypeConfigs?.reduce((qSum, qtc) => qSum + (qtc.numQuestions || 0), 0) || 0);
      }, 0);
      
      // If we have significantly fewer questions than expected, regenerate to include new topics
      // This handles the case where a new topic was added after questions were generated
      if (previewQuestions.length < expectedQuestionCount * 0.8) {
        console.log(`[Preview] Question count mismatch detected - regenerating. Current: ${previewQuestions.length}, Expected: ${expectedQuestionCount}`);
        // Clear preview questions to force regeneration
        setPreviewQuestions([]);
        setQuestions([]);
      } else {
        console.log(`[Preview] Using existing ${previewQuestions.length} preview questions from state - skipping regeneration`);
        setShowPreviewModal(true);
        setCurrentPreviewIndex(0);
        return;
      }
    }

    // Try to load existing preview questions from draft/backend - if found, check if topics match
    if (currentAssessmentId) {
      try {
        const response = await axios.get(`/api/assessments/get-questions?assessmentId=${currentAssessmentId}`);
        console.log("[Preview] Checking for existing questions in backend for assessment:", currentAssessmentId);
        
        // Check for preview questions first (most reliable)
        if (response.data?.success) {
          const assessment = response.data.data?.assessment || response.data.data;
          
          // Get current topic names from validConfigs
          const currentTopicNames = new Set(validConfigs.map(tc => tc.topic.trim().toLowerCase()));
          
          // Get topic names from existing questions (if any)
          const existingQuestions = assessment?.previewQuestions || assessment?.questions || [];
          const existingTopicNames = new Set(
            existingQuestions
              .map((q: any) => q.topic?.trim().toLowerCase())
              .filter((t: string) => t)
          );
          
          // Check if topics match - if new topics were added, regenerate
          const topicsMatch = 
            currentTopicNames.size === existingTopicNames.size &&
            Array.from(currentTopicNames).every(topic => existingTopicNames.has(topic));
          
          console.log(`[Preview] Topic comparison: Current topics (${currentTopicNames.size}):`, Array.from(currentTopicNames));
          console.log(`[Preview] Topic comparison: Existing topics (${existingTopicNames.size}):`, Array.from(existingTopicNames));
          console.log(`[Preview] Topics match: ${topicsMatch}`);
          
          if (!topicsMatch) {
            console.log(`[Preview] Topics don't match - new topic(s) detected. Will regenerate to include all topics.`);
            // Don't load existing questions - proceed to regeneration
          } else if (assessment?.previewQuestions && Array.isArray(assessment.previewQuestions) && assessment.previewQuestions.length > 0) {
            console.log(`[Preview] Found ${assessment.previewQuestions.length} existing preview questions in backend - topics match, loading and skipping regeneration`);
            setPreviewQuestions(assessment.previewQuestions);
            // Also set questions if they don't exist
            if (!assessment.questions || assessment.questions.length === 0) {
              setQuestions(assessment.previewQuestions);
            }
            setCurrentPreviewIndex(0);
            setShowPreviewModal(true);
            return;
          } else if (existingQuestions.length > 0) {
            // Check regular questions if preview questions don't exist
            const questionsList = assessment?.questions || response.data.data?.questions;
            if (questionsList && Array.isArray(questionsList) && questionsList.length > 0) {
              console.log(`[Preview] Found ${questionsList.length} existing questions in backend - topics match, using as preview and skipping regeneration`);
              setPreviewQuestions(questionsList);
              setQuestions(questionsList);
              setCurrentPreviewIndex(0);
              setShowPreviewModal(true);
              return;
            }
          }
        }
        
        console.log("[Preview] No existing questions found in backend or topics don't match - will generate new ones");
      } catch (err: any) {
        console.error("Error loading existing preview questions:", err);
        // Continue to generate new questions if loading fails
      }
    }
    
    // If we reach here, no existing questions were found - proceed with generation
    console.log("[Preview] No existing questions found - proceeding with generation");

    // Transform topics to flat structure - include ALL question type configs with numQuestions > 0
    const flattenedTopics = validConfigs.flatMap((tc) => {
      // Filter out question type configs with numQuestions = 0
      const validQuestionTypeConfigs = (tc.questionTypeConfigs || []).filter(
        (qtc) => qtc.numQuestions > 0
      );
      
      return validQuestionTypeConfigs.flatMap((qtc) => {
        // Create one entry per question (not per question type)
        const questions = [];
        for (let i = 1; i <= qtc.numQuestions; i++) {
          questions.push({
            topic: tc.topic,
            questionType: qtc.questionType,
            difficulty: qtc.difficulty,
            numQuestions: 1, // Each entry represents 1 question
            isAptitude: tc.isAptitude,
            subTopic: tc.subTopic,
            language: qtc.language,
            judge0_enabled: qtc.judge0_enabled,
            questionNumber: i, // Track which question number this is for this topic/type combo
          });
        }
        return questions;
      });
    });

    // Calculate total questions
    const totalQuestions = flattenedTopics.length;
    console.log(`[Preview] Starting generation: ${validConfigs.length} topics, ${totalQuestions} total questions to generate`);
    console.log(`[Preview] Flattened topics breakdown:`, flattenedTopics.map(t => ({
      topic: t.topic,
      questionType: t.questionType,
      difficulty: t.difficulty,
      questionNumber: t.questionNumber
    })));
    
    setPreviewProgress({ current: 0, total: totalQuestions });
    setPreviewGenerating(true);
    setPreviewQuestions([]);
    setCurrentPreviewIndex(0);
    setShowPreviewModal(true);
    setError(null);

    try {
      const allPreviewQuestions: any[] = [];
      let currentIndex = 0;

      // Create a flat list of all question generation tasks
      // flattenedTopics already has one entry per question, so we can use it directly
      const questionTasks: Array<{ topicConfig: any; questionNumber: number; taskIndex: number }> = flattenedTopics.map((topicConfig, idx) => {
        // topicConfig already represents a single question task
        return {
          topicConfig: {
            topic: topicConfig.topic,
            questionType: topicConfig.questionType,
            difficulty: topicConfig.difficulty,
            numQuestions: 1, // Each task generates 1 question
            isAptitude: topicConfig.isAptitude,
            subTopic: topicConfig.subTopic,
            language: topicConfig.language,
            judge0_enabled: topicConfig.judge0_enabled,
          },
          questionNumber: topicConfig.questionNumber || 1,
          taskIndex: idx, // Add unique task index
        };
      });
      
      console.log(`[Preview] Created ${questionTasks.length} question tasks from ${validConfigs.length} topics`);
      console.log(`[Preview] Task breakdown:`, questionTasks.map((t, idx) => 
        `${idx + 1}. ${t.topicConfig.topic} - ${t.topicConfig.questionType} (Q${t.questionNumber})`
      ));

      // Generate first 2 questions immediately (in parallel)
      const firstBatch = questionTasks.slice(0, Math.min(2, questionTasks.length));
      console.log(`[Preview] Generating first batch: ${firstBatch.length} questions`);
      
      const firstBatchPromises = firstBatch.map((task, idx) => {
        console.log(`[Preview] First batch task ${idx + 1}: ${task.topicConfig.topic} - ${task.topicConfig.questionType} (Q${task.questionNumber}, taskIndex=${task.taskIndex})`);
        return generateSingleQuestion(task.topicConfig, task.questionNumber, currentAssessmentId).then((question) => {
          // Add task index to question for tracking
          if (question) {
            question._taskIndex = task.taskIndex;
            question._questionNumber = task.questionNumber;
          }
          return question;
        });
      });

      // Wait for first batch and collect results
      const firstBatchResults = await Promise.all(firstBatchPromises);
      
      // Add all first batch questions to the array (check for duplicates)
      console.log(`[Preview] First batch results: ${firstBatchResults.length} questions received`);
      firstBatchResults.forEach((question, idx) => {
        if (question) {
          console.log(`[Preview] First batch result ${idx + 1}: topic=${question.topic}, type=${question.type}, hasText=${!!(question.questionText || question.question)}`);
          
          // Check if this question already exists (avoid duplicates)
          // Use task index if available, otherwise use question text + topic + type
          const questionExists = allPreviewQuestions.some((q: any) => {
            // If both have task indices, compare by task index
            if (q._taskIndex !== undefined && question._taskIndex !== undefined) {
              return q._taskIndex === question._taskIndex;
            }
            // Otherwise, compare by question text, topic, and type
            const qText = q.questionText || q.question || '';
            const newQText = question.questionText || question.question || '';
            return qText === newQText && q.topic === question.topic && q.type === question.type;
          });
          
          if (questionExists) {
            console.warn(`[Preview] First batch: Question ${idx + 1} already exists, skipping duplicate. Current array length: ${allPreviewQuestions.length}`);
            // Still increment counter for attempt tracking
            currentIndex++;
          } else {
            allPreviewQuestions.push(question);
            currentIndex++;
            console.log(`[Preview] First batch: Added question ${currentIndex}/${totalQuestions} - ${question.topic || 'Unknown'} - ${question.type || 'Unknown'}. Array now has ${allPreviewQuestions.length} questions`);
          }
        } else {
          console.warn(`[Preview] First batch: Failed to generate question ${idx + 1}`);
          // Increment counter even for failed attempts
          currentIndex++;
        }
      });
      
      console.log(`[Preview] First batch complete: ${allPreviewQuestions.length} questions in array, currentIndex=${currentIndex}`);
      
      // Update state once with all first batch questions
      setPreviewProgress({ current: currentIndex, total: totalQuestions });
      const firstBatchQuestions = [...allPreviewQuestions];
      setPreviewQuestions(firstBatchQuestions);
      console.log(`[Preview] First batch: Updated state with ${firstBatchQuestions.length} questions`);
      setShowPreviewModal(true);

      // Queue the rest to generate one after another
      const remainingTasks = questionTasks.slice(firstBatch.length);
      console.log(`[Preview] Generating remaining ${remainingTasks.length} questions sequentially`);
      
      for (let taskIdx = 0; taskIdx < remainingTasks.length; taskIdx++) {
        const task = remainingTasks[taskIdx];
        console.log(`[Preview] Sequential task ${taskIdx + 1}/${remainingTasks.length}: ${task.topicConfig.topic} - ${task.topicConfig.questionType} (Q${task.questionNumber})`);
        
        const question = await generateSingleQuestion(task.topicConfig, task.questionNumber, currentAssessmentId);
        if (question) {
          // Add task index to question for tracking
          question._taskIndex = task.taskIndex;
          question._questionNumber = task.questionNumber;
          
          // Check if this question already exists (avoid duplicates) - check by task index
          const questionExists = allPreviewQuestions.some((q: any) => {
            return q._taskIndex === task.taskIndex;
          });
          
          if (questionExists) {
            console.warn(`[Preview] Sequential: Question with taskIndex ${task.taskIndex} already exists, skipping duplicate`);
          } else {
            allPreviewQuestions.push(question);
            currentIndex++;
            
            // Update progress
            setPreviewProgress({ current: currentIndex, total: totalQuestions });
            
            // Update state with new array reference
            const updatedQuestions = [...allPreviewQuestions];
            setPreviewQuestions(updatedQuestions);
            
            // Preserve current preview index when adding new questions
            // Don't change the index - let the user navigate freely
            // The index will be adjusted by the useEffect if it goes out of bounds
            
            console.log(`[Preview] Sequential: Added question ${currentIndex}/${totalQuestions} at array index ${updatedQuestions.length - 1}. Topic: ${question.topic || 'Unknown'}, Type: ${question.type || 'Unknown'}, taskIndex: ${task.taskIndex}`);
            console.log(`[Preview] Sequential: Question array now has ${updatedQuestions.length} questions:`, updatedQuestions.map((q: any, idx: number) => ({
              arrayIndex: idx,
              taskIndex: q._taskIndex,
              topic: q.topic,
              type: q.type,
              preview: (q.questionText || q.question || '').substring(0, 30)
            })));
          }
          
          // Keep modal open during generation
          setShowPreviewModal(true);
          
          // Small delay to ensure React processes the state update before next question
          await new Promise(resolve => setTimeout(resolve, 100));
          
          // Note: Preview questions will be saved automatically when navigating away (browser back or Back to Dashboard button)
        } else {
          console.warn(`[Preview] Sequential: Failed to generate question ${currentIndex + 1}/${totalQuestions} for topic ${task.topicConfig.topic} - ${task.topicConfig.questionType}`);
          // Even if question generation failed, increment the attempt counter
          // This ensures progress reflects all attempts, not just successes
          currentIndex++;
          setPreviewProgress({ current: currentIndex, total: totalQuestions });
        }
      }

      // Final update to ensure all questions are in state
      setPreviewQuestions((prev) => {
        const final = [...allPreviewQuestions];
        console.log(`[Preview] Final: Setting previewQuestions to ${final.length} questions (prev had ${prev.length})`);
        
        // Also update questions state for review page
        if (final.length > 0) {
          console.log(`[Preview] Also updating questions state with ${final.length} questions for review page`);
          setQuestions(final);
        }
        
        return final;
      });
      
      // Preserve current index when generation completes (don't reset to 0 if user navigated)
      setCurrentPreviewIndex((prevIndex) => {
        const finalCount = allPreviewQuestions.length;
        if (finalCount > 0 && prevIndex >= finalCount) {
          // If index is out of bounds, adjust to last question
          return finalCount - 1;
        }
        // Otherwise, preserve the current index (user might have navigated)
        return prevIndex;
      });
      
      // Keep modal open after generation completes
      setShowPreviewModal(true);
      
      // Note: Preview questions will be saved automatically when navigating away (browser back or Back to Dashboard button)
    } catch (err: any) {
      console.error("Error generating preview questions:", err);
      setError(err.response?.data?.message || err.message || "Failed to generate preview questions");
      setShowPreviewModal(false);
    } finally {
      setPreviewGenerating(false);
    }
  };

  const generateSingleQuestion = async (topicConfig: any, questionNumber: number, assessmentIdToUse?: string): Promise<any | null> => {
    const idToUse = assessmentIdToUse || assessmentId;
    if (!idToUse) {
      console.error("Assessment ID is required for generating preview questions");
      return null;
    }
    
    try {
      const response = await axios.post("/api/assessments/generate-questions-from-config", {
        assessmentId: idToUse,
        skill: selectedSkills.join(", "),
        topics: [{
          ...topicConfig,
          numQuestions: 1, // Generate only 1 question
        }],
      });

      if (response.data?.success && response.data.data.topics) {
        // Handle case where backend returns multiple topics (shouldn't happen, but handle it)
        // Also handle case where a topic has multiple questions
        const topics = response.data.data.topics;
        console.log(`[generateSingleQuestion] Backend returned ${topics.length} topic(s) for ${topicConfig.topic}`);
        
        // Iterate through all topics to find questions
        for (const topic of topics) {
          if (topic.questions && Array.isArray(topic.questions) && topic.questions.length > 0) {
            // If we find questions, return the first one
            // Log if there are multiple questions
            if (topic.questions.length > 1) {
              console.warn(`[generateSingleQuestion] Topic ${topic.topic} has ${topic.questions.length} questions, returning first one`);
            }
            const question = topic.questions[0];
            console.log(`[generateSingleQuestion] Returning question from topic: ${topic.topic}, question type: ${question.type || 'unknown'}`);
            return question;
          }
        }
        
        // If no questions found in any topic, log warning
        console.warn(`[generateSingleQuestion] No questions found in response for topic ${topicConfig.topic}`);
      }
      return null;
    } catch (err: any) {
      console.error(`Error generating question ${questionNumber} for topic ${topicConfig.topic}:`, err);
      return null;
    }
  };

  const handleRemoveQuestion = (questionIndex: number) => {
    setQuestions(questions.filter((_, idx) => idx !== questionIndex));
  };

  const handleEditQuestion = (questionIndex: number) => {
    const question = previewQuestions[questionIndex];
    if (question) {
      setEditingQuestion({ ...question });
      setEditingQuestionIndex(questionIndex);
    }
  };

  const handleSaveEditedQuestion = async () => {
    if (editingQuestionIndex === null || !editingQuestion || !assessmentId) {
      return;
    }

    try {
      const question = previewQuestions[editingQuestionIndex];
      const topic = question.topic;

      // Update the question in preview questions
      const updated = [...previewQuestions];
      updated[editingQuestionIndex] = { ...editingQuestion };
      setPreviewQuestions(updated);

      // Note: Draft will be saved automatically when navigating away (browser back or Back to Dashboard button)

      setEditingQuestionIndex(null);
      setEditingQuestion(null);
      setError(null);
    } catch (err: any) {
      console.error("Error saving edited question:", err);
      setError(err.response?.data?.message || err.message || "Failed to save edited question");
    }
  };

  const handleRegenerateQuestion = async (questionIndex: number) => {
    if (!assessmentId) {
      setError("Assessment ID not found");
      return;
    }

    setRegeneratingQuestionIndex(questionIndex);
    setError(null);

    try {
      const question = previewQuestions[questionIndex];
      if (!question) {
        setError("Question not found");
        return;
      }

      // Get skills from assessment if not in state
      let skillsToUse = selectedSkills;
      if (!skillsToUse || skillsToUse.length === 0) {
        try {
          const assessmentResponse = await axios.get(`/api/assessments/get-questions?assessmentId=${assessmentId}`);
          if (assessmentResponse.data?.success) {
            const assessment = assessmentResponse.data.data.assessment || assessmentResponse.data.data;
            if (assessment.selectedSkills && assessment.selectedSkills.length > 0) {
              skillsToUse = assessment.selectedSkills;
            }
          }
        } catch (err) {
          console.error("Error fetching skills:", err);
        }
      }

      if (!skillsToUse || skillsToUse.length === 0) {
        setError("No skills found. Please go back to Station 1 and select skills.");
        setRegeneratingQuestionIndex(null);
        return;
      }

      // Generate a new question with the same topic and type
      const topicConfig = {
        topic: question.topic,
        questionType: question.type,
        difficulty: question.difficulty || "Medium",
        numQuestions: 1,
        isAptitude: question.isAptitude || false,
        subTopic: question.subTopic,
        language: question.language,
        judge0_enabled: question.judge0_enabled,
      };

      const response = await axios.post("/api/assessments/generate-questions-from-config", {
        assessmentId,
        skill: skillsToUse.join(", "),
        topics: [topicConfig],
      });

      if (response.data?.success && response.data.data.topics) {
        const topic = response.data.data.topics[0];
        if (topic.questions && topic.questions.length > 0) {
          const newQuestion = topic.questions[0];
          // Preserve the topic and other metadata
          newQuestion.topic = question.topic;
          
          // Update the question in preview questions
          const updated = [...previewQuestions];
          updated[questionIndex] = newQuestion;
          setPreviewQuestions(updated);

          // Note: Draft will be saved automatically when navigating away (browser back or Back to Dashboard button)
        } else {
          setError("Failed to generate new question");
        }
      } else {
        setError("Failed to regenerate question");
      }
    } catch (err: any) {
      console.error("Error regenerating question:", err);
      setError(err.response?.data?.message || err.message || "Failed to regenerate question");
    } finally {
      setRegeneratingQuestionIndex(null);
    }
  };

  // Email validation function
  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const handleAddCandidate = async () => {
    // Validate email format
    const email = candidateEmail.trim().toLowerCase();
    const name = candidateName.trim();
    
    if (!name) {
      setEmailValidationError("Name is required");
        return;
      }
    
    if (!email) {
      setEmailValidationError("Email is required");
      return;
    }
    
    if (!validateEmail(email)) {
      setEmailValidationError("Invalid email format");
      return;
    }
    
    // Check if email already exists (case insensitive)
    if (candidates.some((c) => c.email.toLowerCase() === email)) {
      setEmailValidationError("This email is already added");
      return;
    }
    
    setEmailValidationError(null);
    
    const newCandidate = { 
      email, 
      name,
      invited: false,
      status: "pending"
    };
    
    const updatedCandidates = [...candidates, newCandidate];
    setCandidates(updatedCandidates);
      setCandidateEmail("");
      setCandidateName("");
      setError(null);
    
    // Autosave to draft
    if (assessmentId) {
      try {
        await axios.put("/api/assessments/update-draft", {
          assessmentId,
          candidates: updatedCandidates,
          accessMode: accessMode,
        });
      } catch (err: any) {
        console.error("Error autosaving candidate:", err);
      }
    }
  };

  const handleRemoveCandidate = async (email: string) => {
    const updatedCandidates = candidates.filter((c) => c.email.toLowerCase() !== email.toLowerCase());
    setCandidates(updatedCandidates);
    
    // Autosave to draft
    if (assessmentId) {
      try {
        await axios.put("/api/assessments/update-draft", {
          assessmentId,
          candidates: updatedCandidates,
          accessMode: accessMode,
        });
      } catch (err: any) {
        console.error("Error autosaving after remove:", err);
      }
    }
  };

  const handleCsvUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.name.endsWith('.csv')) {
      setError("Please upload a CSV file");
      return;
    }

    setUploadingCsv(true);
    setError(null);

    try {
      const text = await file.text();
      const lines = text.split('\n').filter(line => line.trim());
      
      if (lines.length === 0) {
        setError("CSV file is empty");
        setUploadingCsv(false);
        return;
      }

      // Parse header row
      const header = lines[0].split(',').map(h => h.trim().toLowerCase());
      const nameIndex = header.findIndex(h => h === 'name');
      const emailIndex = header.findIndex(h => h === 'email');

      if (nameIndex === -1 || emailIndex === -1) {
        setError("CSV must contain 'name' and 'email' columns");
        setUploadingCsv(false);
        return;
      }

      // Parse data rows
      const newCandidates: Array<{ email: string; name: string }> = [];
      const existingEmails = new Set(candidates.map(c => c.email.toLowerCase()));
      const duplicateEmails: string[] = [];
      const invalidRows: number[] = [];

      for (let i = 1; i < lines.length; i++) {
        const row = lines[i].split(',').map(cell => cell.trim());
        const email = row[emailIndex]?.trim();
        const name = row[nameIndex]?.trim();

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!email || !name || !emailRegex.test(email)) {
          invalidRows.push(i + 1);
          continue;
        }

        // Check for duplicates in CSV
        if (newCandidates.some(c => c.email.toLowerCase() === email.toLowerCase())) {
          duplicateEmails.push(email);
          continue;
        }

        // Check for duplicates with existing candidates
        if (existingEmails.has(email.toLowerCase())) {
          duplicateEmails.push(email);
          continue;
        }

        newCandidates.push({ email, name });
        existingEmails.add(email.toLowerCase());
      }

      if (newCandidates.length === 0) {
        let errorMsg = "No valid candidates found in CSV. ";
        if (invalidRows.length > 0) {
          errorMsg += `Invalid rows: ${invalidRows.slice(0, 5).join(', ')}${invalidRows.length > 5 ? '...' : ''}. `;
        }
        if (duplicateEmails.length > 0) {
          errorMsg += `Duplicate emails: ${duplicateEmails.slice(0, 5).join(', ')}${duplicateEmails.length > 5 ? '...' : ''}.`;
        }
        setError(errorMsg);
        setUploadingCsv(false);
        return;
      }

      // Add new candidates
      setCandidates([...candidates, ...newCandidates]);
      
      // Show success message with warnings if any
      if (invalidRows.length > 0 || duplicateEmails.length > 0) {
        let warningMsg = `Successfully added ${newCandidates.length} candidate(s). `;
        if (invalidRows.length > 0) {
          warningMsg += `Skipped ${invalidRows.length} invalid row(s). `;
        }
        if (duplicateEmails.length > 0) {
          warningMsg += `Skipped ${duplicateEmails.length} duplicate email(s).`;
        }
        setError(warningMsg);
      } else {
        setError(null);
      }

    } catch (err: any) {
      console.error("Error parsing CSV:", err);
      setError("Error reading CSV file. Please check the file format.");
    } finally {
      setUploadingCsv(false);
      // Reset file input
      event.target.value = '';
    }
  };

  const handleBackToDashboard = async () => {
    if (!assessmentId) {
      // If no assessment ID, just navigate to dashboard
      router.push("/dashboard");
      return;
    }

    try {
      // Ensure we have a title - use job designation as fallback
      const titleToSave = finalTitle || (jobDesignation.trim() ? `Assessment for ${jobDesignation.trim()}` : "Untitled Assessment");
      
      // Save all current state to draft before navigating
      const draftData: any = {
        assessmentId: assessmentId,
        title: titleToSave,
        description: finalDescription || "",
        jobDesignation: jobDesignation.trim(),
        selectedSkills: selectedSkills,
        experienceMin: experienceMin,
        experienceMax: experienceMax,
      };

      // Add topics if configured
      if (topicConfigs.length > 0) {
        draftData.topics = topicConfigs;
      }

      // Add preview questions if available
      if (previewQuestions.length > 0) {
        draftData.previewQuestions = previewQuestions;
      }

      // Add questions if available (from Station 3)
      if (questions.length > 0) {
        draftData.questions = questions;
        draftData.questionTypeTimes = questionTypeTimes;
        draftData.enablePerSectionTimers = enablePerSectionTimers;
        draftData.passPercentage = passPercentage;
      }

      // Add schedule if available (from Station 4)
      if (startTime && endTime) {
        // Normalize datetime strings to ISO format
        const normalizeDateTime = (dt: string): string => {
          if (!dt) return dt;
          if (dt.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)) {
            const dtWithSeconds = dt + ":00";
            const istDate = new Date(dtWithSeconds + "+05:30");
            if (!isNaN(istDate.getTime())) {
              return istDate.toISOString();
            } else {
              return dt + ":00Z";
            }
          }
          if (dt.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)) {
            return dt + "Z";
          }
          return dt;
        };
        
        draftData.schedule = {
          startTime: normalizeDateTime(startTime),
          endTime: normalizeDateTime(endTime),
        };
      }

      // Add candidates if available (from Station 5)
      if (candidates.length > 0) {
        draftData.candidates = candidates;
      }

      if (assessmentUrl) {
        draftData.assessmentUrl = assessmentUrl;
      }

      // Save draft
      await axios.put("/api/assessments/update-draft", draftData);
      
      // Navigate to dashboard
      router.push("/dashboard");
    } catch (err: any) {
      console.error("Error saving draft before navigating:", err);
      // Still navigate to dashboard even if save fails
      router.push("/dashboard");
    }
  };

  const handleGenerateUrl = async () => {
    if (!assessmentId) {
      setError("Assessment ID not found");
      return;
    }

    // Generate unique URL - using assessment ID and a random token
    const token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    const url = `${window.location.origin}/assessment/${assessmentId}/${token}`;
    setAssessmentUrl(url);

    // Save schedule and candidates to backend
    try {
      // Normalize datetime strings to ISO format with seconds and timezone
      // datetime-local input gives format: YYYY-MM-DDTHH:MM (no seconds, no timezone)
      // We need to convert IST (UTC+5:30) to UTC and add seconds
      const normalizeDateTime = (dt: string): string => {
        if (!dt) return dt;
        
        // If format is YYYY-MM-DDTHH:MM (missing seconds), add :00
        if (dt.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)) {
          // Parse as IST (UTC+5:30) and convert to UTC ISO string
          // datetime-local input is in local timezone, but we treat it as IST
          // Create a date object assuming IST timezone
          const dtWithSeconds = dt + ":00";
          // Create date assuming IST (UTC+5:30)
          const istDate = new Date(dtWithSeconds + "+05:30");
          
          if (!isNaN(istDate.getTime())) {
            // Convert to ISO string (UTC)
            return istDate.toISOString();
          } else {
            // Fallback: just add seconds and Z
            return dt + ":00Z";
          }
        }
        
        // If already has seconds but no timezone, add Z
        if (dt.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)) {
          return dt + "Z";
        }
        
        return dt;
      };

      // Calculate timer mode information
      const scheduledWindow = (new Date(endTime).getTime() - new Date(startTime).getTime()) / (1000 * 60); // in minutes
      let timerModeData: any = {};
      
      if (enablePerSectionTimers) {
        // Use sectionTimers (from Review Questions) instead of questionTypeTimes
        const totalTimeFromSections = Object.values(sectionTimers).reduce((sum, time) => sum + time, 0);
        timerModeData = {
          timerMode: "section",
          sectionTotalTime: totalTimeFromSections,
          scheduledWindowTime: scheduledWindow,
        };
      } else {
        timerModeData = {
          timerMode: "scheduleOnly",
          examDuration: scheduledWindow,
        };
      }

      await axios.post("/api/assessments/update-schedule-and-candidates", {
        assessmentId,
        startTime: normalizeDateTime(startTime),
        endTime: normalizeDateTime(endTime),
        candidates: accessMode === "private" ? candidates : [],
        assessmentUrl: url,
        token,
        accessMode: accessMode,
        invitationTemplate: accessMode === "private" ? invitationTemplate : undefined,
        ...timerModeData,
      });
    } catch (err: any) {
      console.error("Error saving schedule and candidates:", err);
      setError("Failed to save schedule and candidates");
    }
  };

  const handleCopyUrl = () => {
    if (assessmentUrl) {
      navigator.clipboard.writeText(assessmentUrl);
      // You could show a toast notification here
      alert("URL copied to clipboard!");
    }
  };


  const handleFinalize = async () => {

    setLoading(true);
    setError(null);

    try {
      // First, update all questions in the assessment
      // Group questions by topic
      const questionsByTopic: { [key: string]: any[] } = {};
      questions.forEach((q) => {
        const topic = q.topic || "Unknown";
        if (!questionsByTopic[topic]) {
          questionsByTopic[topic] = [];
        }
        questionsByTopic[topic].push(q);
      });

      // Update questions for each topic
      for (const [topic, topicQuestions] of Object.entries(questionsByTopic)) {
        try {
          await axios.put("/api/assessments/update-questions", {
            assessmentId,
            topic,
            updatedQuestions: topicQuestions,
          });
        } catch (err) {
          console.error(`Error updating questions for topic ${topic}:`, err);
        }
      }

      // Then finalize with questionTypeTimes, enablePerSectionTimers flag, and passPercentage
      // Fetch the assessment to get the title and description from Station 1
      let assessmentTitle = "";
      let assessmentDescription = "";
      try {
        const assessmentResponse = await axios.get(`/api/assessments/get-questions?assessmentId=${assessmentId}`);
        if (assessmentResponse.data?.success && assessmentResponse.data.data?.assessment) {
          assessmentTitle = assessmentResponse.data.data.assessment.title || "";
          assessmentDescription = assessmentResponse.data.data.assessment.description || "";
        }
      } catch (err) {
        console.error("Error fetching assessment for title:", err);
      }

      const response = await axios.post("/api/assessments/finalize", {
        assessmentId,
        title: assessmentTitle.trim() || "Untitled Assessment",
        description: assessmentDescription.trim() || undefined,
        questionTypeTimes: enablePerSectionTimers ? questionTypeTimes : undefined,
        enablePerSectionTimers: enablePerSectionTimers,
        passPercentage: passPercentage,
      });

      if (response.data?.success) {
        // SINGLE DRAFT: No need to clear localStorage - backend maintains single draft
        setCurrentStation(4);
      } else {
        setError("Failed to finalize assessment");
      }
    } catch (err: any) {
      console.error("Error finalizing assessment:", err);
      setError(err.response?.data?.message || err.message || "Failed to finalize assessment");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ backgroundColor: "#f1dcba", minHeight: "100vh", padding: "2rem 0" }}>
      <div className="container">
        <div className="card">
          {/* Progress Line */}
          <div style={{ marginBottom: "3rem" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                position: "relative",
                marginBottom: "1rem",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: "50%",
                  left: 0,
                  right: 0,
                  height: "3px",
                  backgroundColor: "#e2e8f0",
                  zIndex: 0,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  top: "50%",
                  left: 0,
                  width: currentStation >= 5 ? "100%" : currentStation >= 4 ? "75%" : currentStation >= 3 ? "50%" : currentStation >= 2 ? "25%" : "0%",
                  height: "3px",
                  backgroundColor: "#6953a3",
                  zIndex: 1,
                  transition: "width 0.3s ease",
                }}
              />
              {[1, 2, 3, 4, 5].map((station) => (
                <div
                  key={station}
                  style={{
                    position: "relative",
                    zIndex: 2,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    flex: 1,
                  }}
                >
                  <div
                    style={{
                      width: "40px",
                      height: "40px",
                      borderRadius: "50%",
                      backgroundColor: currentStation >= station ? "#6953a3" : "#e2e8f0",
                      color: currentStation >= station ? "#ffffff" : "#64748b",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 700,
                      fontSize: "1.125rem",
                      transition: "all 0.3s ease",
                    }}
                  >
                    {station}
                  </div>
                  <span
                    style={{
                      marginTop: "0.5rem",
                      fontSize: "0.875rem",
                      color: currentStation >= station ? "#6953a3" : "#64748b",
                      fontWeight: currentStation >= station ? 600 : 400,
                    }}
                  >
                    {station === 1 ? "Topics" : station === 2 ? "Configure" : station === 3 ? "Review" : station === 4 ? "Schedule" : "Candidates"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {error && (
            <div className="alert alert-error" style={{ marginBottom: "1.5rem" }}>
              {error}
            </div>
          )}

          {loadingDraft && (
            <div className="alert" style={{ marginBottom: "1.5rem", backgroundColor: "#f0f9ff", border: "1px solid #3b82f6" }}>
              Loading draft assessment...
            </div>
          )}

          {/* Station 1: Topics */}
          {currentStation === 1 && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <div style={{ flex: 1 }}>
              <h1 style={{ marginBottom: "0.5rem", fontSize: "2rem", color: "#1a1625", fontWeight: 700 }}>
                {isEditMode ? "Edit Assessment" : "Create Assessment"}
              </h1>
              <p style={{ color: "#6b6678", marginBottom: "2rem", fontSize: "1rem" }}>
                {isEditMode ? "Edit your assessment details" : "Enter a job designation or domain to get started"}
              </p>
                </div>
                <button
                  type="button"
                  onClick={handleBackToDashboard}
                  className="btn-secondary"
                  style={{ 
                    marginLeft: "1rem",
                    whiteSpace: "nowrap",
                    padding: "0.75rem 1.5rem",
                    fontSize: "0.875rem"
                  }}
                >
                  Back to Dashboard
                </button>
              </div>

              <div style={{ marginBottom: "2rem" }}>
                <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
                  Assessment Title <span style={{ color: "#dc2626" }}>*</span>
                </label>
                <input
                  type="text"
                  value={finalTitle}
                  onChange={(e) => setFinalTitle(e.target.value)}
                  placeholder="Enter assessment title"
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    border: "1px solid #e2e8f0",
                    borderRadius: "0.5rem",
                    fontSize: "1rem",
                  }}
                />
              </div>

              <div style={{ marginBottom: "2rem" }}>
                <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
                  Job Designation / Domain *
                </label>
                  <input
                    type="text"
                    value={jobDesignation}
                    onChange={(e) => setJobDesignation(e.target.value)}
                    placeholder="e.g., Software Engineering, Aptitude, Data Scientist, Frontend Developer"
                    style={{
                    width: "100%",
                      padding: "0.75rem",
                      border: "1px solid #e2e8f0",
                      borderRadius: "0.5rem",
                      fontSize: "1rem",
                    }}
                  />
              </div>

              {/* Topic Cards Display */}
              {topicCards.length > 0 && (isEditMode || !hasVisitedConfigureStation) && (
                <div style={{ marginBottom: "2rem" }}>
                  <label style={{ display: "block", marginBottom: "0.75rem", fontWeight: 600, color: "#1e293b" }}>
                    Related Technologies & Skills
                  </label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
                    {topicCards.map((card) => (
                      <button
                        key={card}
                        type="button"
                        onClick={() => handleCardClick(card)}
                        disabled={!isEditMode && selectedSkills.includes(card)}
                        style={{
                          padding: "0.5rem 1rem",
                          border: `1px solid ${selectedSkills.includes(card) ? "#6953a3" : "#e2e8f0"}`,
                          borderRadius: "0.5rem",
                          backgroundColor: selectedSkills.includes(card) ? "#eff6ff" : "#ffffff",
                          color: selectedSkills.includes(card) ? "#1e40af" : "#475569",
                          cursor: (!isEditMode && selectedSkills.includes(card)) ? "default" : "pointer",
                          fontSize: "0.875rem",
                          fontWeight: selectedSkills.includes(card) ? 600 : 400,
                          opacity: (!isEditMode && selectedSkills.includes(card)) ? 0.7 : 1,
                        }}
                      >
                        {card} {selectedSkills.includes(card) && "✓"}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Experience Mode Selection */}
              <div style={{ marginBottom: "2rem" }}>
                <label style={{ display: "block", marginBottom: "0.75rem", fontWeight: 600, color: "#1e293b" }}>
                  Experience Mode <span style={{ color: "#dc2626" }}>*</span>
                </label>
                <div style={{ display: "flex", gap: "1rem" }}>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      cursor: (isEditMode || !hasVisitedConfigureStation) ? "pointer" : "default",
                      opacity: (isEditMode || !hasVisitedConfigureStation) ? 1 : 0.6,
                      pointerEvents: (isEditMode || !hasVisitedConfigureStation) ? "auto" : "none",
                    }}
                  >
                    <input
                      type="radio"
                      name="experienceMode"
                      value="corporate"
                      checked={experienceMode === "corporate"}
                      onChange={(e) => {
                        setExperienceMode(e.target.value as "corporate" | "student");
                        // Reset experience range when switching modes
                        if (e.target.value === "corporate") {
                          setExperienceMin(0);
                          setExperienceMax(10);
                        } else {
                          setExperienceMin(0);
                          setExperienceMax(3); // Default to 1st-4th year for students
                        }
                      }}
                      style={{ cursor: "pointer" }}
                    />
                    <span style={{ fontSize: "1rem", color: "#1e293b" }}>Corporate Experience</span>
                  </label>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      cursor: (isEditMode || !hasVisitedConfigureStation) ? "pointer" : "default",
                      opacity: (isEditMode || !hasVisitedConfigureStation) ? 1 : 0.6,
                      pointerEvents: (isEditMode || !hasVisitedConfigureStation) ? "auto" : "none",
                    }}
                  >
                    <input
                      type="radio"
                      name="experienceMode"
                      value="student"
                      checked={experienceMode === "student"}
                      onChange={(e) => {
                        setExperienceMode(e.target.value as "corporate" | "student");
                        // Reset experience range when switching modes
                        if (e.target.value === "student") {
                          setExperienceMin(0);
                          setExperienceMax(3); // Default to 1st-4th year for students
                        } else {
                          setExperienceMin(0);
                          setExperienceMax(10);
                        }
                      }}
                      style={{ cursor: "pointer" }}
                    />
                    <span style={{ fontSize: "1rem", color: "#1e293b" }}>College Student Experience</span>
                  </label>
                </div>
              </div>

              <div style={{ marginBottom: "2rem" }}>
                <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
                  {experienceMode === "corporate" ? "Experience Range (Years)" : "Experience Level"}
                </label>
                <div
                  ref={sliderRef}
                  style={{
                    position: "relative",
                    width: "100%",
                    height: "6px",
                    backgroundColor: "#e2e8f0",
                    borderRadius: "3px",
                    marginTop: "2rem",
                    marginBottom: "1rem",
                    cursor: (isEditMode || !hasVisitedConfigureStation) ? "pointer" : "default",
                    opacity: (isEditMode || !hasVisitedConfigureStation) ? 1 : 0.6,
                  }}
                >
                  <div
                    ref={minHandleRef}
                    style={{
                      position: "absolute",
                      width: "20px",
                      height: "20px",
                      backgroundColor: "#6953a3",
                      borderRadius: "50%",
                      top: "50%",
                      transform: "translate(-50%, -50%)",
                      cursor: (isEditMode || !hasVisitedConfigureStation) ? "grab" : "default",
                      zIndex: 3,
                      userSelect: "none",
                      touchAction: "none",
                      pointerEvents: (isEditMode || !hasVisitedConfigureStation) ? "auto" : "none",
                    }}
                  />
                  <div
                    ref={maxHandleRef}
                    style={{
                      position: "absolute",
                      width: "20px",
                      height: "20px",
                      backgroundColor: "#6953a3",
                      borderRadius: "50%",
                      top: "50%",
                      transform: "translate(-50%, -50%)",
                      cursor: (isEditMode || !hasVisitedConfigureStation) ? "grab" : "default",
                      zIndex: 3,
                      userSelect: "none",
                      touchAction: "none",
                      pointerEvents: (isEditMode || !hasVisitedConfigureStation) ? "auto" : "none",
                    }}
                  />
                </div>
                {experienceMode === "corporate" ? (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.875rem", color: "#64748b", marginTop: "0.5rem" }}>
                      <span>{experienceMin} years</span>
                      <span>{experienceMax} years</span>
                    </div>
                    <div style={{ textAlign: "center", fontSize: "0.875rem", color: "#6953a3", fontWeight: 600, marginTop: "0.25rem" }}>
                      {experienceMin}-{experienceMax} years
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.875rem", color: "#64748b", marginTop: "0.5rem" }}>
                      <span>{getStudentLevel(experienceMin)}</span>
                      <span>{getStudentLevel(experienceMax)}</span>
                    </div>
                    <div style={{ textAlign: "center", fontSize: "0.875rem", color: "#6953a3", fontWeight: 600, marginTop: "0.25rem" }}>
                      {(() => {
                        const minLevel = getStudentLevel(experienceMin);
                        const maxLevel = getStudentLevel(experienceMax);
                        return minLevel === maxLevel ? minLevel : `${minLevel} - ${maxLevel}`;
                      })()}
                    </div>
                  </>
                )}
              </div>

              {/* Skills we want to assess section */}
              <div style={{ marginBottom: "2rem" }}>
                <label style={{ display: "block", marginBottom: "0.75rem", fontWeight: 600, color: "#1e293b" }}>
                  Skills we want to assess *
                </label>
                {selectedSkills.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginBottom: "1rem" }}>
                    {selectedSkills.map((skill) => (
                      <div
                        key={skill}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.5rem",
                          backgroundColor: "#eff6ff",
                          color: "#1e40af",
                          padding: "0.5rem 1rem",
                          borderRadius: "0.5rem",
                          fontSize: "0.875rem",
                          fontWeight: 500,
                        }}
                      >
                        {skill}
                        {(isEditMode || !hasVisitedConfigureStation) && (
                          <button
                            type="button"
                            onClick={() => handleRemoveSkill(skill)}
                            style={{
                              background: "none",
                              border: "none",
                              color: "#1e40af",
                              cursor: "pointer",
                              padding: 0,
                              fontSize: "1.125rem",
                              lineHeight: 1,
                            }}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {(isEditMode || !hasVisitedConfigureStation) && (
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <input
                      type="text"
                      value={manualSkillInput}
                      onChange={(e) => setManualSkillInput(e.target.value)}
                      onKeyPress={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddManualSkill();
                        }
                      }}
                      placeholder="Enter technology name (e.g., Python, React, HTML)"
                      style={{
                        flex: 1,
                        padding: "0.75rem",
                        border: "1px solid #e2e8f0",
                        borderRadius: "0.5rem",
                        fontSize: "1rem",
                      }}
                    />
                    <button
                      type="button"
                      onClick={handleAddManualSkill}
                      className="btn-secondary"
                      disabled={!manualSkillInput.trim()}
                      style={{ marginTop: 0, whiteSpace: "nowrap", padding: "0.75rem 1.5rem" }}
                    >
                      Add
                    </button>
                  </div>
                )}
              </div>

              <div style={{ display: "flex", gap: "1rem", marginTop: "2rem" }}>
                {/* Check if topics have been generated (either in edit mode or after generating topics) */}
                {(() => {
                  // If topicsV2 has any topics, it means topics have been generated
                  // This is simpler and more reliable than checking question status
                  const hasGeneratedTopics = topicsV2 && topicsV2.length > 0;
                  
                  return isEditMode || hasGeneratedTopics ? (
                    <>
                      {/* Show Next button if in edit mode or if topics have been generated */}
                      <button
                        type="button"
                        onClick={() => {
                          // Navigate to Station 2 (Configure Topics)
                          setCurrentStation(2);
                        }}
                        className="btn-primary"
                        style={{ flex: 1 }}
                      >
                        Next
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={async () => {
                          if (selectedSkills.length === 0) {
                            setError("Please select at least one skill to assess");
                            return;
                          }
                          if (!jobDesignation.trim()) {
                            setError("Please enter a job designation");
                            return;
                          }
                          await handleGenerateTopics();
                        }}
                        className="btn-primary"
                        disabled={loading || selectedSkills.length === 0 || !jobDesignation.trim()}
                        style={{ flex: 1 }}
                      >
                        {loading ? "Generating Topics..." : "Generate Topics"}
                      </button>
                      {(selectedSkills.length === 0 || !jobDesignation.trim()) && (
                        <div style={{ 
                          fontSize: "0.875rem", 
                          color: "#dc2626", 
                          marginTop: "0.5rem",
                          textAlign: "center"
                        }}>
                          {selectedSkills.length === 0 && !jobDesignation.trim() 
                            ? "Please select at least one skill and enter a job designation"
                            : selectedSkills.length === 0 
                            ? "Please select at least one skill"
                            : "Please enter a job designation"}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          {/* Station 2: Configure Topics (NEW V2 IMPLEMENTATION) */}
          {currentStation === 2 && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <div style={{ flex: 1 }}>
                  <h1 style={{ marginBottom: "0.5rem", fontSize: "2rem", color: "#1a1625", fontWeight: 700 }}>
                    Configure Topics
                  </h1>
                  <p style={{ color: "#6b6678", marginBottom: "1rem", fontSize: "1rem" }}>
                    Configure question type, difficulty, and number of questions for each topic. You can also add your own topics.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleBackToDashboard}
                  className="btn-secondary"
                  style={{ 
                    marginLeft: "1rem",
                    whiteSpace: "nowrap",
                    padding: "0.75rem 1.5rem",
                    fontSize: "0.875rem"
                  }}
                >
                  Back to Dashboard
                </button>
              </div>

              {/* Error Display */}
              {error && (
                <div style={{
                  padding: "1rem",
                  backgroundColor: "#fee2e2",
                  border: "1px solid #fecaca",
                  borderRadius: "0.5rem",
                  color: "#dc2626",
                  marginBottom: "1.5rem"
                }}>
                  {error}
                </div>
              )}

              {/* Toast Message */}
              {toastMessage && (
                <div style={{
                  position: "fixed",
                  top: "2rem",
                  right: "2rem",
                  padding: "1rem 1.5rem",
                  backgroundColor: "#fef3c7",
                  border: "1px solid #fbbf24",
                  borderRadius: "0.5rem",
                  color: "#92400e",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                  zIndex: 2000,
                  boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
                  animation: "fadeIn 0.3s ease-in",
                }}>
                  {toastMessage}
                </div>
              )}

              {/* Preview All Questions Button */}
              <div style={{ marginBottom: "1.5rem", display: "flex", justifyContent: "flex-end", gap: "1rem" }}>
                <button
                  type="button"
                  onClick={handlePreviewAllQuestionsV2}
                  disabled={topicsV2.length === 0 || generatingAllQuestions}
                  className="btn-secondary"
                  style={{ 
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    opacity: (topicsV2.length === 0 || generatingAllQuestions) ? 0.5 : 1
                  }}
                >
                  {generatingAllQuestions ? "Generating Questions..." : "Preview All Questions"}
                </button>
              </div>



              {/* Topics Table (Multi-Row V2) */}
              <div style={{ overflowX: "auto", marginBottom: "1rem" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ backgroundColor: "#f8fafc" }}>
                      <th style={{ padding: "1rem", textAlign: "left", borderBottom: "2px solid #e2e8f0", fontWeight: 600, color: "#1e293b" }}>
                        Topic
                      </th>
                      <th style={{ padding: "1rem", textAlign: "left", borderBottom: "2px solid #e2e8f0", fontWeight: 600, color: "#1e293b" }}>
                        Question Type
                      </th>
                      <th style={{ padding: "1rem", textAlign: "left", borderBottom: "2px solid #e2e8f0", fontWeight: 600, color: "#1e293b" }}>
                        Difficulty
                      </th>
                      <th style={{ padding: "1rem", textAlign: "left", borderBottom: "2px solid #e2e8f0", fontWeight: 600, color: "#1e293b" }}>
                        Questions Count
                      </th>
                      <th style={{ padding: "1rem", textAlign: "left", borderBottom: "2px solid #e2e8f0", fontWeight: 600, color: "#1e293b" }}>
                        Status
                      </th>
                      <th style={{ padding: "1rem", textAlign: "left", borderBottom: "2px solid #e2e8f0", fontWeight: 600, color: "#1e293b" }}>
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {topicsV2 && topicsV2.length > 0 ? (
                      topicsV2.flatMap((topic) => {
                        const canRegenerate = !topic.locked && !fullTopicRegenLocked;
                        const canAddRow = !topic.locked && !allQuestionsGenerated;
                        
                        return topic.questionRows.map((row, rowIndex) => {
                          const isFirstRow = rowIndex === 0;
                          const canPreview = !allQuestionsGenerated; // Allow preview even if locked (to view existing questions)
                          // Restrict question types for aptitude/communication/logical_reasoning
                          // Use allowedQuestionTypes if available (for soft skills), otherwise determine from category
                          const isSpecialCategory = topic.category && ["aptitude", "communication", "logical_reasoning"].includes(topic.category);
                          const questionTypes = topic.allowedQuestionTypes && topic.allowedQuestionTypes.length > 0
                            ? topic.allowedQuestionTypes // Use allowedQuestionTypes if defined
                            : isSpecialCategory 
                              ? ["MCQ", "Subjective"] 
                              : [
                                  "MCQ", 
                                  "Subjective", 
                                  "PseudoCode", 
                                  ...(row.canUseJudge0 ? ["Coding"] : [])
                                ];
                          
                          return (
                            <tr key={`${topic.id}-${row.rowId}`} style={{ borderBottom: "1px solid #e2e8f0" }}>
                              <td style={{ padding: "1rem", verticalAlign: "top" }}>
                                {isFirstRow && (
                                  <>
                                    {(() => {
                                      // Check if this is a custom topic with generated questions
                                      const isCustomTopic = topic.questionRows.length === 1 && 
                                                            topic.questionRows[0].questionsCount === 1 &&
                                                            topic.questionRows.some(row => {
                                                              const rowStatus = row.status;
                                                              const isGeneratedOrCompleted = rowStatus === "generated" || rowStatus === "completed";
                                                              return row.questions && row.questions.length > 0 && isGeneratedOrCompleted;
                                                            });
                                      const isCustomTopicDisabled = isCustomTopic;
                                      
                                      return (
                                    <button
                                      type="button"
                                      onClick={() => handleRegenerateTopicV2(topic.id)}
                                          disabled={!canRegenerate || generatingRowId !== null || isCustomTopicDisabled}
                                          title={
                                            isCustomTopicDisabled 
                                              ? "Custom topics cannot be regenerated. Use Preview on the question row to regenerate." 
                                              : !canRegenerate 
                                                ? "Topic regeneration is locked" 
                                                : "Regenerate this topic"
                                          }
                                      style={{
                                        marginBottom: "0.5rem",
                                        padding: "0.375rem 0.75rem",
                                            background: (canRegenerate && !isCustomTopicDisabled) ? "#3b82f6" : "#94a3b8",
                                        border: "none",
                                        color: "#ffffff",
                                            cursor: (canRegenerate && !isCustomTopicDisabled && generatingRowId === null) ? "pointer" : "not-allowed",
                                        fontSize: "0.75rem",
                                        fontWeight: 500,
                                        borderRadius: "0.375rem",
                                            opacity: (canRegenerate && !isCustomTopicDisabled && generatingRowId === null) ? 1 : 0.6,
                                      }}
                                    >
                                      Regenerate Topic
                                    </button>
                                      );
                                    })()}
                                    <div style={{ position: "relative" }}>
                                      <input
                                        type="text"
                                        value={topicInputValues[topic.id] !== undefined ? topicInputValues[topic.id] : topic.label}
                                        onChange={(e) => handleTopicNameChange(topic.id, e.target.value)}
                                        onFocus={() => {
                                          const specialCategories = ["aptitude", "communication", "logical_reasoning"] as const;
                                          if (topic.category && specialCategories.includes(topic.category as any) && topic.label.length >= 2) {
                                            setShowingSuggestionsFor(topic.id);
                                            fetchTopicSuggestions(topic.label, topic.category);
                                          }
                                        }}
                                        onBlur={() => {
                                          // Delay hiding suggestions to allow clicking
                                          setTimeout(() => setShowingSuggestionsFor(null), 200);
                                        }}
                                        placeholder="Enter topic name"
                                        disabled={topic.locked}
                                        style={{
                                          width: "100%",
                                          padding: "0.5rem",
                                          border: "1px solid #e2e8f0",
                                          borderRadius: "0.5rem",
                                          fontSize: "0.875rem",
                                          backgroundColor: topic.locked ? "#f1f5f9" : "#ffffff",
                                          cursor: topic.locked ? "not-allowed" : "text",
                                          opacity: topic.locked ? 0.6 : 1,
                                        }}
                                      />
                                      
                                      {/* Suggestions Dropdown */}
                                      {showingSuggestionsFor === topic.id && topicSuggestions.length > 0 && !topic.locked && (
                                        <div style={{
                                          position: "absolute",
                                          top: "100%",
                                          left: 0,
                                          right: 0,
                                          marginTop: "0.25rem",
                                          backgroundColor: "#ffffff",
                                          border: "1px solid #e2e8f0",
                                          borderRadius: "0.5rem",
                                          boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
                                          zIndex: 1000,
                                          maxHeight: "200px",
                                          overflowY: "auto",
                                        }}>
                                          {topicSuggestions.map((suggestion, idx) => (
                                            <div
                                              key={idx}
                                              onClick={() => {
                                                handleTopicNameChange(topic.id, suggestion.value);
                                                setShowingSuggestionsFor(null);
                                                setTopicSuggestions([]);
                                              }}
                                              style={{
                                                padding: "0.75rem",
                                                cursor: "pointer",
                                                borderBottom: idx < topicSuggestions.length - 1 ? "1px solid #f1f5f9" : "none",
                                                fontSize: "0.875rem",
                                                color: "#1e293b",
                                              }}
                                              onMouseEnter={(e) => {
                                                e.currentTarget.style.backgroundColor = "#f8fafc";
                                              }}
                                              onMouseLeave={(e) => {
                                                e.currentTarget.style.backgroundColor = "#ffffff";
                                              }}
                                            >
                                              {suggestion.label}
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                      
                                    </div>
                                  </>
                                )}
                              </td>
                              <td style={{ padding: "1rem" }}>
                                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                                  <select
                                    value={row.questionType}
                                    onChange={(e) => {
                                      const newType = e.target.value as "MCQ" | "Subjective" | "PseudoCode" | "Coding";
                                      handleUpdateRow(topic.id, row.rowId, "questionType", newType);
                                      
                                      // If changing to Coding and canUseJudge0 is false, update it
                                      if (newType === "Coding" && !row.canUseJudge0) {
                                        handleUpdateRow(topic.id, row.rowId, "canUseJudge0", true);
                                      }
                                      // If changing away from Coding, set canUseJudge0 to false
                                      if (newType !== "Coding" && row.canUseJudge0) {
                                        handleUpdateRow(topic.id, row.rowId, "canUseJudge0", false);
                                      }
                                    }}
                                    disabled={row.locked}
                                    style={{
                                      flex: 1,
                                      padding: "0.5rem",
                                      border: "1px solid #e2e8f0",
                                      borderRadius: "0.5rem",
                                      fontSize: "0.875rem",
                                      backgroundColor: row.locked ? "#f1f5f9" : "#ffffff",
                                      cursor: row.locked ? "not-allowed" : "pointer",
                                      opacity: row.locked ? 0.6 : 1,
                                    }}
                                  >
                                    {questionTypes.map((type) => {
                                      // Disable Coding option if coding_supported is false for technical topics
                                      // Use topic.coding_supported (engine-driven) instead of row.canUseJudge0
                                      const isCodingDisabled = type === "Coding" && 
                                        topic.category === "technical" && 
                                        (topic.coding_supported === false || (!topic.coding_supported && !row.canUseJudge0));
                                      return (
                                        <option 
                                          key={type} 
                                          value={type}
                                          disabled={isCodingDisabled}
                                          style={{
                                            color: isCodingDisabled ? "#94a3b8" : "#1e293b",
                                          }}
                                        >
                                          {type}{isCodingDisabled ? " (Not supported)" : ""}
                                        </option>
                                      );
                                    })}
                                  </select>
                                  {canAddRow && isFirstRow && (
                                    <button
                                      type="button"
                                      onClick={() => handleAddQuestionRow(topic.id)}
                                      title="Add question type row"
                                      style={{
                                        padding: "0.5rem",
                                        background: "none",
                                        border: "1px solid #10b981",
                                        color: "#10b981",
                                        cursor: "pointer",
                                        fontSize: "1.25rem",
                                        fontWeight: 600,
                                        borderRadius: "0.25rem",
                                        width: "32px",
                                        height: "32px",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                      }}
                                    >
                                      +
                                    </button>
                                  )}
                                  {topic.questionRows.length > 1 && (
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveQuestionRow(topic.id, row.rowId)}
                                      disabled={row.locked}
                                      title="Remove this question type row"
                                      style={{
                                        padding: "0.5rem",
                                        background: "none",
                                        border: "1px solid #ef4444",
                                        color: "#ef4444",
                                        cursor: row.locked ? "not-allowed" : "pointer",
                                        fontSize: "1.25rem",
                                        fontWeight: 600,
                                        borderRadius: "0.25rem",
                                        width: "32px",
                                        height: "32px",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        opacity: row.locked ? 0.5 : 1,
                                      }}
                                    >
                                      −
                                    </button>
                                  )}
                                </div>
                              </td>
                              <td style={{ padding: "1rem" }}>
                                <select
                                  value={row.difficulty}
                                  onChange={(e) => handleUpdateRow(topic.id, row.rowId, "difficulty", e.target.value)}
                                  disabled={row.locked}
                                  style={{
                                    width: "100%",
                                    padding: "0.5rem",
                                    border: "1px solid #e2e8f0",
                                    borderRadius: "0.5rem",
                                    fontSize: "0.875rem",
                                    backgroundColor: row.locked ? "#f1f5f9" : "#ffffff",
                                    cursor: row.locked ? "not-allowed" : "pointer",
                                    opacity: row.locked ? 0.6 : 1,
                                  }}
                                >
                                  {["Easy", "Medium", "Hard"].map((level) => (
                                    <option key={level} value={level}>
                                      {level}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td style={{ padding: "1rem" }}>
                                <input
                                  type="number"
                                  min="1"
                                  max="20"
                                  value={row.questionsCount}
                                  onChange={(e) => handleUpdateRow(topic.id, row.rowId, "questionsCount", parseInt(e.target.value) || 1)}
                                  disabled={row.locked}
                                  style={{
                                    width: "100%",
                                    padding: "0.5rem",
                                    border: "1px solid #e2e8f0",
                                    borderRadius: "0.5rem",
                                    fontSize: "0.875rem",
                                    backgroundColor: row.locked ? "#f1f5f9" : "#ffffff",
                                    cursor: row.locked ? "not-allowed" : "text",
                                    opacity: row.locked ? 0.6 : 1,
                                  }}
                                />
                              </td>
                              <td style={{ padding: "1rem" }}>
                                <span style={{
                                  padding: "0.25rem 0.75rem",
                                  borderRadius: "0.375rem",
                                  fontSize: "0.75rem",
                                  fontWeight: 500,
                                }}>
                                  {(() => {
                                    const rowStatus = row.status;
                                    const isGeneratedOrCompleted = rowStatus === "generated" || rowStatus === "completed";
                                    return (
                                      <span style={{
                                        backgroundColor: isGeneratedOrCompleted ? "#d1fae5" : "#fef3c7",
                                        color: isGeneratedOrCompleted ? "#065f46" : "#92400e",
                                      }}>
                                        {isGeneratedOrCompleted ? "Generated" : "Pending"}
                                      </span>
                                    );
                                  })()}
                                </span>
                                {row.locked && (
                                  <span style={{ marginLeft: "0.5rem", fontSize: "0.75rem", color: "#64748b" }}>
                                    (Locked)
                                  </span>
                                )}
                              </td>
                              <td style={{ padding: "1rem" }}>
                                <div style={{ display: "flex", gap: "0.5rem", flexDirection: "column" }}>
                                  {(() => {
                                    // Check if this is a custom topic (single row with questionsCount: 1)
                                    const isCustomTopic = topic.questionRows.length === 1 && topic.questionRows[0].questionsCount === 1;
                                    // Allow preview for custom topics even if allQuestionsGenerated is true
                                    const canPreviewCustomTopic = isCustomTopic && row.status === "pending";
                                    // Allow preview if: not generating, and (has questions OR is custom topic pending OR not all generated)
                                    const canPreview = generatingRowId !== row.rowId && 
                                                      (row.questions && row.questions.length > 0 || 
                                                       canPreviewCustomTopic || 
                                                       !allQuestionsGenerated) &&
                                                      !(row.locked && (!row.questions || row.questions.length === 0));
                                    
                                    return (
                                  <button
                                    type="button"
                                    onClick={() => handlePreviewRow(topic.id, row.rowId)}
                                        disabled={!canPreview}
                                    title={
                                      generatingRowId === row.rowId 
                                        ? "Generating..." 
                                            : !canPreview && row.locked && (!row.questions || row.questions.length === 0)
                                        ? "Row is locked but has no questions"
                                        : row.questions && row.questions.length > 0
                                        ? "View questions" 
                                        : "Preview questions for this row"
                                    }
                                    style={{
                                      position: "relative",
                                      width: "110px",
                                      padding: "0.5rem 1rem",
                                          background: canPreview ? "#10b981" : "#94a3b8",
                                      border: "none",
                                      color: "#ffffff",
                                          cursor: canPreview ? "pointer" : "not-allowed",
                                      fontSize: "0.75rem",
                                      fontWeight: 500,
                                      borderRadius: "0.375rem",
                                          opacity: canPreview ? 1 : 0.6,
                                      textAlign: "center",
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                    }}
                                  >
                                    <span style={{ 
                                      visibility: generatingRowId === row.rowId ? "hidden" : "visible",
                                      display: "inline-block",
                                    }}>
                                      {row.questions && row.questions.length > 0 ? "View" : "Preview"}
                                    </span>
                                    {generatingRowId === row.rowId && (
                                      <span style={{
                                        position: "absolute",
                                        top: "50%",
                                        left: "50%",
                                        transform: "translate(-50%, -50%)",
                                        display: "inline-block",
                                        animation: "spin 1s linear infinite",
                                      }}>
                                        ⟳
                                      </span>
                                    )}
                                  </button>
                                    );
                                  })()}
                                  {isFirstRow && (
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveTopicV2(topic.id)}
                                      disabled={topic.locked}
                                      title="Remove topic"
                                      style={{
                                        padding: "0.5rem 1rem",
                                        background: "none",
                                        border: "1px solid #ef4444",
                                        color: "#ef4444",
                                        cursor: topic.locked ? "not-allowed" : "pointer",
                                        fontSize: "0.75rem",
                                        fontWeight: 500,
                                        borderRadius: "0.375rem",
                                        opacity: topic.locked ? 0.5 : 1,
                                      }}
                                    >
                                      Remove Topic
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        });
                      })
                    ) : (
                      <tr>
                        <td colSpan={6} style={{ padding: "2rem", textAlign: "center", color: "#64748b" }}>
                          {loadingDraft ? (
                            "Loading topics..."
                          ) : isEditMode && assessmentId ? (
                            <div>
                              <p>Topics are being loaded...</p>
                              <p style={{ fontSize: "0.875rem", marginTop: "0.5rem", color: "#64748b" }}>
                                If topics don't appear, please refresh the page.
                              </p>
                            </div>
                          ) : (
                            "No topics configured yet. Please generate topics from Station 1 or add a custom topic below."
                          )}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Custom Topic Input (V2) with Category Selection */}
              <div style={{ marginTop: "2rem", padding: "1.5rem", backgroundColor: "#f8fafc", borderRadius: "0.75rem", border: "1px solid #e2e8f0" }}>
                <label style={{ display: "block", marginBottom: "0.75rem", fontWeight: 600, color: "#1e293b" }}>
                  Add Custom Topic
                </label>
                
                {/* Soft Skill Category Selection Tabs */}
                <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap", alignItems: "center" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCategoryForNewTopic("aptitude");
                      setShowTechnicalInput(false);
                    }}
                    style={{
                      padding: "0.5rem 1rem",
                      background: selectedCategoryForNewTopic === "aptitude" ? "#3b82f6" : "#ffffff",
                      border: `2px solid ${selectedCategoryForNewTopic === "aptitude" ? "#3b82f6" : "#e2e8f0"}`,
                      color: selectedCategoryForNewTopic === "aptitude" ? "#ffffff" : "#1e293b",
                      cursor: "pointer",
                      fontSize: "0.875rem",
                      fontWeight: 500,
                      borderRadius: "0.5rem",
                      transition: "all 0.2s",
                    }}
                  >
                    Aptitude
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCategoryForNewTopic("communication");
                      setShowTechnicalInput(false);
                    }}
                    style={{
                      padding: "0.5rem 1rem",
                      background: selectedCategoryForNewTopic === "communication" ? "#3b82f6" : "#ffffff",
                      border: `2px solid ${selectedCategoryForNewTopic === "communication" ? "#3b82f6" : "#e2e8f0"}`,
                      color: selectedCategoryForNewTopic === "communication" ? "#ffffff" : "#1e293b",
                      cursor: "pointer",
                      fontSize: "0.875rem",
                      fontWeight: 500,
                      borderRadius: "0.5rem",
                      transition: "all 0.2s",
                    }}
                  >
                    Communication
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCategoryForNewTopic("logical_reasoning");
                      setShowTechnicalInput(false);
                    }}
                    style={{
                      padding: "0.5rem 1rem",
                      background: selectedCategoryForNewTopic === "logical_reasoning" ? "#3b82f6" : "#ffffff",
                      border: `2px solid ${selectedCategoryForNewTopic === "logical_reasoning" ? "#3b82f6" : "#e2e8f0"}`,
                      color: selectedCategoryForNewTopic === "logical_reasoning" ? "#ffffff" : "#1e293b",
                      cursor: "pointer",
                      fontSize: "0.875rem",
                      fontWeight: 500,
                      borderRadius: "0.5rem",
                      transition: "all 0.2s",
                    }}
                  >
                    Logical Reasoning
                  </button>
                  
                  {/* Separate Technical Skill Button */}
                  <button
                    type="button"
                    onClick={() => {
                      setShowTechnicalInput(true);
                      setSelectedCategoryForNewTopic(null);
                      setCustomTopicInputV2("");
                      setShowAiSuggestions(false);
                      setAiTopicSuggestions([]);
                    }}
                    style={{
                      padding: "0.5rem 1rem",
                      background: showTechnicalInput ? "#10b981" : "#ffffff",
                      border: `2px solid ${showTechnicalInput ? "#10b981" : "#e2e8f0"}`,
                      color: showTechnicalInput ? "#ffffff" : "#1e293b",
                      cursor: "pointer",
                      fontSize: "0.875rem",
                      fontWeight: 500,
                      borderRadius: "0.5rem",
                      transition: "all 0.2s",
                      marginLeft: "auto",
                    }}
                  >
                    Add Technical Skill
                  </button>
                </div>
                
                {/* Soft Skill Input Area (shown when a soft skill tab is selected) */}
                {!showTechnicalInput && selectedCategoryForNewTopic && (
                  <div style={{ position: "relative", display: "flex", gap: "0.5rem" }}>
                    <div style={{ flex: 1, position: "relative" }}>
                      <input
                        ref={customTopicInputRef}
                        type="text"
                        value={customTopicInputV2}
                        onChange={(e) => {
                          const value = e.target.value;
                          setCustomTopicInputV2(value);
                          
                          // Fetch AI-powered suggestions ONLY for soft skills
                          if (selectedCategoryForNewTopic) {
                            fetchAiTopicSuggestions(value, selectedCategoryForNewTopic);
                          }
                        }}
                        onFocus={() => {
                          // Show suggestions if there's input or category is selected
                          if (customTopicInputV2.trim() || selectedCategoryForNewTopic) {
                            fetchAiTopicSuggestions(customTopicInputV2, selectedCategoryForNewTopic);
                          }
                        }}
                        onBlur={(e) => {
                          // Check if the blur is due to clicking a suggestion
                          // If the relatedTarget is within the suggestions dropdown, don't close
                          const relatedTarget = e.relatedTarget as HTMLElement;
                          if (relatedTarget && relatedTarget.closest('[data-suggestions-dropdown]')) {
                            return; // Don't close if clicking inside suggestions
                          }
                          // Delay hiding to allow clicking suggestions
                          // Use a longer delay to ensure click events fire first
                          setTimeout(() => {
                            // Only close if input is not focused (user clicked outside)
                            if (document.activeElement !== e.currentTarget) {
                              setShowAiSuggestions(false);
                            }
                          }, 300);
                        }}
                        onKeyPress={(e) => {
                          if (e.key === "Enter") {
                            handleAddCustomTopicV2(false);
                            setShowAiSuggestions(false);
                          }
                        }}
                        placeholder={
                          selectedCategoryForNewTopic === "aptitude" 
                            ? "Enter aptitude topic name…"
                            : selectedCategoryForNewTopic === "communication"
                            ? "Enter communication topic name…"
                            : "Enter logical reasoning topic name…"
                        }
                        disabled={loading}
                        style={{
                          width: "100%",
                          padding: "0.75rem",
                          border: "1px solid #e2e8f0",
                          borderRadius: "0.5rem",
                          fontSize: "0.875rem",
                          backgroundColor: "#ffffff",
                          cursor: "text",
                          opacity: loading ? 0.6 : 1,
                        }}
                      />
                      
                      {/* AI-Powered Suggestions Dropdown (ONLY for soft skills) */}
                      {showAiSuggestions && (aiTopicSuggestions.length > 0 || loadingAiSuggestions) && (
                        <div 
                          data-suggestions-dropdown
                          style={{
                            position: "absolute",
                            top: "100%",
                            left: 0,
                            right: 0,
                            marginTop: "0.25rem",
                            backgroundColor: "#ffffff",
                            border: "1px solid #e2e8f0",
                            borderRadius: "0.5rem",
                            boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
                            zIndex: 1000,
                            maxHeight: "300px",
                            overflowY: "auto",
                          }}
                        >
                          {loadingAiSuggestions ? (
                            <div style={{ padding: "1rem", textAlign: "center", color: "#64748b", fontSize: "0.875rem" }}>
                              Generating suggestions...
                            </div>
                          ) : aiTopicSuggestions.length > 0 ? (
                            aiTopicSuggestions.map((suggestion, idx) => {
                              // Highlight matching text
                              const query = customTopicInputV2.toLowerCase();
                              const suggestionLower = suggestion.toLowerCase();
                              const matchIndex = suggestionLower.indexOf(query);
                              
                              return (
                                <div
                                  key={idx}
                                  onMouseDown={(e) => {
                                    // Prevent input blur when clicking suggestion
                                    e.preventDefault();
                                  }}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    console.log("Suggestion item clicked:", suggestion); // Debug
                                    handleSuggestionClick(suggestion);
                                  }}
                                  style={{
                                    padding: "0.75rem",
                                    cursor: "pointer",
                                    borderBottom: idx < aiTopicSuggestions.length - 1 ? "1px solid #f1f5f9" : "none",
                                    fontSize: "0.875rem",
                                    color: "#1e293b",
                                  }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.backgroundColor = "#f8fafc";
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.backgroundColor = "#ffffff";
                                  }}
                                >
                                  {matchIndex >= 0 && query.length > 0 ? (
                                    <>
                                      {suggestion.substring(0, matchIndex)}
                                      <strong style={{ color: "#3b82f6" }}>
                                        {suggestion.substring(matchIndex, matchIndex + query.length)}
                                      </strong>
                                      {suggestion.substring(matchIndex + query.length)}
                                    </>
                                  ) : (
                                    suggestion
                                  )}
                                </div>
                              );
                            })
                          ) : (
                            <div style={{ padding: "1rem", textAlign: "center", color: "#64748b", fontSize: "0.875rem" }}>
                              No suggestions found
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={handleAddSoftSkillTopic}
                      disabled={loading || !customTopicInputV2.trim()}
                      style={{
                        padding: "0.75rem 1.5rem",
                        background: loading || !customTopicInputV2.trim() ? "#94a3b8" : "#10b981",
                        border: "none",
                        color: "#ffffff",
                        cursor: loading || !customTopicInputV2.trim() ? "not-allowed" : "pointer",
                        fontSize: "0.875rem",
                        fontWeight: 500,
                        borderRadius: "0.5rem",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {selectedCategoryForNewTopic === "aptitude" 
                        ? "Add Aptitude Topic"
                        : selectedCategoryForNewTopic === "communication"
                        ? "Add Communication Topic"
                        : "Add Logical Reasoning Topic"}
                    </button>
                  </div>
                )}

                {/* Technical Input Area (shown when "Add Technical Skill" is clicked) */}
                {showTechnicalInput && (
                  <div style={{ display: "flex", gap: "0.5rem", flexDirection: "column" }}>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <input
                        type="text"
                        value={customTopicInputV2}
                        onChange={(e) => {
                          setCustomTopicInputV2(e.target.value);
                          // NO AI suggestions for technical topics
                          setShowAiSuggestions(false);
                          setAiTopicSuggestions([]);
                        }}
                        onKeyPress={(e) => {
                          if (e.key === "Enter") {
                            handleAddCustomTopicV2(true);
                          }
                        }}
                        placeholder="Enter technical topic name…"
                        disabled={loading}
                        style={{
                          flex: 1,
                          padding: "0.75rem",
                          border: "1px solid #e2e8f0",
                          borderRadius: "0.5rem",
                          fontSize: "0.875rem",
                          backgroundColor: "#ffffff",
                          cursor: "text",
                          opacity: loading ? 0.6 : 1,
                        }}
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleAddCustomTopicV2(true, undefined, e);
                        }}
                        disabled={loading || !customTopicInputV2.trim()}
                        style={{
                          padding: "0.75rem 1.5rem",
                          background: loading || !customTopicInputV2.trim() ? "#94a3b8" : "#10b981",
                          border: "none",
                          color: "#ffffff",
                          cursor: loading || !customTopicInputV2.trim() ? "not-allowed" : "pointer",
                          fontSize: "0.875rem",
                          fontWeight: 500,
                          borderRadius: "0.5rem",
                          whiteSpace: "nowrap",
                        }}
                      >
                        Add Technical Topic
                      </button>
                    </div>
                    <div style={{ fontSize: "0.8125rem", color: "#64748b", marginTop: "0.25rem" }}>
                      Add a specific technical topic. Technical topics do not show suggestions.
                    </div>
                  </div>
                )}

                {/* Message when no category is selected */}
                {!showTechnicalInput && !selectedCategoryForNewTopic && (
                  <div style={{ padding: "1rem", textAlign: "center", color: "#64748b", fontSize: "0.875rem", backgroundColor: "#f1f5f9", borderRadius: "0.5rem" }}>
                    Select a soft skill category above or click "Add Technical Skill" to add a topic.
                  </div>
                )}
                
              </div>

              {/* Regenerate All Topics Button (V2) */}
              <div style={{ display: "flex", gap: "1rem", marginTop: "1.5rem" }}>
                <button
                  type="button"
                  onClick={handleRegenerateAllTopicsV2}
                  disabled={fullTopicRegenLocked || allQuestionsGenerated || loading || !assessmentId}
                  className="btn-secondary"
                  style={{ 
                    flex: 1, 
                    opacity: (fullTopicRegenLocked || allQuestionsGenerated || loading || !assessmentId) ? 0.5 : 1 
                  }}
                >
                  {loading ? "Regenerating..." : "Regenerate All Topics"}
                </button>
              </div>

              <div style={{ display: "flex", gap: "1rem", marginTop: "2rem" }}>
                    <button
                      type="button"
                  onClick={() => setCurrentStation(1)}
                      className="btn-secondary"
                      style={{ flex: 1 }}
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={() => setCurrentStation(3)}
                      className="btn-primary"
                      style={{ 
                        flex: 1,
                        opacity: generatingAllQuestions ? 0.6 : 1,
                        cursor: generatingAllQuestions ? "not-allowed" : "pointer"
                      }}
                      disabled={generatingAllQuestions}
                      title={
                        generatingAllQuestions 
                          ? "Please wait for all questions to be generated" 
                          : undefined
                      }
                    >
                      Next
                    </button>
              </div>
            </div>
          )}

          {/* Single Preview Modal */}
          {showSinglePreview && singlePreviewTopic && singlePreviewRow && (
            <div style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(0, 0, 0, 0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1000,
            }}>
              <div style={{
                backgroundColor: "#ffffff",
                borderRadius: "0.75rem",
                padding: "2rem",
                maxWidth: "90vw",
                maxHeight: "90vh",
                overflow: "auto",
                width: "800px",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
                  <h2 style={{ fontSize: "1.5rem", fontWeight: 600, color: "#1e293b" }}>
                    Preview: {singlePreviewTopic.label}
                  </h2>
                  <button
                    type="button"
                    onClick={() => {
                      setShowSinglePreview(false);
                      setSinglePreviewTopic(null);
                      setSinglePreviewRow(null);
                      setEditingSingleQuestion(null);
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      fontSize: "1.5rem",
                      cursor: "pointer",
                      color: "#64748b",
                    }}
                  >
                    ×
                  </button>
                </div>
                
                {singlePreviewRow.questions && singlePreviewRow.questions.length > 0 && (() => {
                  const currentQuestion = singlePreviewRow.questions[singlePreviewQuestionIndex];
                  const isEditing = editingSingleQuestion !== null;
                  
                  return (
                    <div>
                      <div style={{ marginBottom: "1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: "0.875rem", color: "#64748b" }}>
                          Question {singlePreviewQuestionIndex + 1} of {singlePreviewRow.questions.length}
                        </span>
                        <div style={{ display: "flex", gap: "0.5rem" }}>
                          <button
                            type="button"
                            onClick={() => {
                              setSinglePreviewQuestionIndex(prev => Math.max(0, prev - 1));
                              setEditingSingleQuestion(null);
                            }}
                            disabled={singlePreviewQuestionIndex === 0}
                            style={{
                              padding: "0.5rem 1rem",
                              background: singlePreviewQuestionIndex === 0 ? "#94a3b8" : "#3b82f6",
                              border: "none",
                              color: "#ffffff",
                              cursor: singlePreviewQuestionIndex === 0 ? "not-allowed" : "pointer",
                              borderRadius: "0.375rem",
                            }}
                          >
                            Previous
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSinglePreviewQuestionIndex(prev => Math.min(singlePreviewRow.questions.length - 1, prev + 1));
                              setEditingSingleQuestion(null);
                            }}
                            disabled={singlePreviewQuestionIndex >= singlePreviewRow.questions.length - 1}
                            style={{
                              padding: "0.5rem 1rem",
                              background: singlePreviewQuestionIndex >= singlePreviewRow.questions.length - 1 ? "#94a3b8" : "#3b82f6",
                              border: "none",
                              color: "#ffffff",
                              cursor: singlePreviewQuestionIndex >= singlePreviewRow.questions.length - 1 ? "not-allowed" : "pointer",
                              borderRadius: "0.375rem",
                            }}
                          >
                            Next
                          </button>
                        </div>
                      </div>
                      
                      <div style={{
                        padding: "1.5rem",
                        backgroundColor: "#ffffff",
                        borderRadius: "0.5rem",
                        border: "1px solid #e2e8f0",
                        marginBottom: "1rem",
                      }}>
                        {renderQuestionByType(
                          isEditing ? editingSingleQuestion : currentQuestion,
                          singlePreviewRow.questionType,
                          isEditing,
                          isEditing ? (value: string) => {
                            try {
                              setEditingSingleQuestion(JSON.parse(value));
                            } catch {}
                          } : undefined
                        )}
                      </div>
                      
                      <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                      <button
                        type="button"
                        onClick={() => {
                          const question = singlePreviewRow.questions[singlePreviewQuestionIndex];
                          setEditingSingleQuestion({ ...question });
                        }}
                        disabled={editingSingleQuestion !== null}
                        style={{
                          padding: "0.5rem 1rem",
                          background: editingSingleQuestion !== null ? "#94a3b8" : "#10b981",
                          border: "none",
                          color: "#ffffff",
                          cursor: editingSingleQuestion !== null ? "not-allowed" : "pointer",
                          borderRadius: "0.375rem",
                        }}
                      >
                        {editingSingleQuestion !== null ? "Editing..." : "Edit Question"}
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!editingSingleQuestion) return;
                          // Save edited question
                          const updatedTopics = topicsV2.map(t => {
                            if (t.id === singlePreviewTopic.id) {
                              const updatedRows = t.questionRows.map(r => {
                                if (r.rowId === singlePreviewRow.rowId) {
                                  const updatedQuestions = [...r.questions];
                                  updatedQuestions[singlePreviewQuestionIndex] = editingSingleQuestion;
                                  return { ...r, questions: updatedQuestions };
                                }
                                return r;
                              });
                              return { ...t, questionRows: updatedRows };
                            }
                            return t;
                          });
                          setTopicsV2(updatedTopics);
                          const updatedTopic = updatedTopics.find(t => t.id === singlePreviewTopic.id);
                          const updatedRow = updatedTopic?.questionRows.find(r => r.rowId === singlePreviewRow.rowId);
                          if (updatedRow) {
                            setSinglePreviewRow(updatedRow);
                          }
                          setEditingSingleQuestion(null);
                        }}
                        disabled={!editingSingleQuestion}
                        style={{
                          padding: "0.5rem 1rem",
                          background: editingSingleQuestion ? "#3b82f6" : "#94a3b8",
                          border: "none",
                          color: "#ffffff",
                          cursor: editingSingleQuestion ? "pointer" : "not-allowed",
                          borderRadius: "0.375rem",
                        }}
                      >
                        Save Question
                      </button>
                      {editingSingleQuestion && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingSingleQuestion(null);
                          }}
                          style={{
                            padding: "0.5rem 1rem",
                            background: "none",
                            border: "1px solid #64748b",
                            color: "#64748b",
                            cursor: "pointer",
                            borderRadius: "0.375rem",
                          }}
                        >
                          Cancel Edit
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={async () => {
                          if (!assessmentId) return;
                          try {
                            const response = await axios.post("/api/assessments/regenerate-single-question", {
                              assessmentId: assessmentId,
                              topicId: singlePreviewTopic.id,
                              rowId: singlePreviewRow.rowId,
                              questionIndex: singlePreviewQuestionIndex,
                            });
                            if (response.data?.success) {
                              const updatedRow = response.data.data.row;
                              const updatedTopics = topicsV2.map(t => {
                                if (t.id === singlePreviewTopic.id) {
                                  const updatedRows = t.questionRows.map(r => r.rowId === singlePreviewRow.rowId ? updatedRow : r);
                                  return { ...t, questionRows: updatedRows };
                                }
                                return t;
                              });
                              setTopicsV2(updatedTopics);
                              setSinglePreviewRow(updatedRow);
                            }
                          } catch (err: any) {
                            console.error("Error regenerating question:", err);
                            setError(err.response?.data?.message || err.message || "Failed to regenerate question");
                          }
                        }}
                        style={{
                          padding: "0.5rem 1rem",
                          background: "#f59e0b",
                          border: "none",
                          color: "#ffffff",
                          cursor: "pointer",
                          borderRadius: "0.375rem",
                        }}
                      >
                        Regenerate This Question
                      </button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* Bulk Preview Modal */}
          {showBulkPreview && bulkPreviewTopics.length > 0 && (() => {
            // Calculate current question position
            const currentTopic = bulkPreviewTopics[bulkPreviewCurrentTopicIndex];
            const currentRow = currentTopic?.questionRows[bulkPreviewCurrentRowIndex];
            const currentQuestion = currentRow?.questions?.[bulkPreviewCurrentQuestionIndex];
            
            // Calculate total questions for navigation
            let totalQuestions = 0;
            let currentQuestionNumber = 0;
            bulkPreviewTopics.forEach((topic, tIdx) => {
              topic.questionRows.forEach((row, rIdx) => {
                const qCount = row.questions?.length || 0;
                if (tIdx < bulkPreviewCurrentTopicIndex || 
                    (tIdx === bulkPreviewCurrentTopicIndex && rIdx < bulkPreviewCurrentRowIndex) ||
                    (tIdx === bulkPreviewCurrentTopicIndex && rIdx === bulkPreviewCurrentRowIndex && currentQuestion)) {
                  currentQuestionNumber += qCount;
                }
                totalQuestions += qCount;
              });
            });
            if (currentQuestion) {
              currentQuestionNumber += bulkPreviewCurrentQuestionIndex + 1;
            }
            
            // Helper to get next question position
            const getNextPosition = () => {
              let tIdx = bulkPreviewCurrentTopicIndex;
              let rIdx = bulkPreviewCurrentRowIndex;
              let qIdx = bulkPreviewCurrentQuestionIndex;
              
              // Try next question in current row
              if (currentRow?.questions && qIdx < currentRow.questions.length - 1) {
                return { topicIndex: tIdx, rowIndex: rIdx, questionIndex: qIdx + 1 };
              }
              
              // Try next row in current topic
              if (currentTopic?.questionRows && rIdx < currentTopic.questionRows.length - 1) {
                const nextRow = currentTopic.questionRows[rIdx + 1];
                if (nextRow.questions && nextRow.questions.length > 0) {
                  return { topicIndex: tIdx, rowIndex: rIdx + 1, questionIndex: 0 };
                }
              }
              
              // Try next topic
              for (let i = tIdx + 1; i < bulkPreviewTopics.length; i++) {
                const topic = bulkPreviewTopics[i];
                for (let j = 0; j < topic.questionRows.length; j++) {
                  const row = topic.questionRows[j];
                  if (row.questions && row.questions.length > 0) {
                    return { topicIndex: i, rowIndex: j, questionIndex: 0 };
                  }
                }
              }
              
              return null; // No next question
            };
            
            // Helper to get previous question position
            const getPreviousPosition = () => {
              let tIdx = bulkPreviewCurrentTopicIndex;
              let rIdx = bulkPreviewCurrentRowIndex;
              let qIdx = bulkPreviewCurrentQuestionIndex;
              
              // Try previous question in current row
              if (qIdx > 0) {
                return { topicIndex: tIdx, rowIndex: rIdx, questionIndex: qIdx - 1 };
              }
              
              // Try previous row in current topic
              if (rIdx > 0) {
                for (let j = rIdx - 1; j >= 0; j--) {
                  const prevRow = currentTopic.questionRows[j];
                  if (prevRow.questions && prevRow.questions.length > 0) {
                    return { topicIndex: tIdx, rowIndex: j, questionIndex: prevRow.questions.length - 1 };
                  }
                }
              }
              
              // Try previous topic
              for (let i = tIdx - 1; i >= 0; i--) {
                const topic = bulkPreviewTopics[i];
                for (let j = topic.questionRows.length - 1; j >= 0; j--) {
                  const row = topic.questionRows[j];
                  if (row.questions && row.questions.length > 0) {
                    return { topicIndex: i, rowIndex: j, questionIndex: row.questions.length - 1 };
                  }
                }
              }
              
              return null; // No previous question
            };
            
            const nextPos = getNextPosition();
            const prevPos = getPreviousPosition();
            
            return (
              <div style={{
                position: "fixed",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: "rgba(0, 0, 0, 0.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 1000,
              }}>
                <div style={{
                  backgroundColor: "#ffffff",
                  borderRadius: "0.75rem",
                  padding: "2rem",
                  maxWidth: "95vw",
                  maxHeight: "95vh",
                  overflow: "auto",
                  width: "1200px",
                  display: "flex",
                  flexDirection: "column",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
                    <div>
                      <h2 style={{ fontSize: "1.5rem", fontWeight: 600, color: "#1e293b", marginBottom: "0.5rem" }}>
                        Bulk Preview: All Questions
                      </h2>
                      <div style={{ fontSize: "0.875rem", color: "#64748b" }}>
                        {currentTopic && (
                          <>
                            Topic: {currentTopic.label} | 
                            Row: {currentRow?.questionType} ({currentRow?.difficulty}) | 
                            Question {currentQuestionNumber} of {totalQuestions}
                            {generatingAllQuestions && " (Generating...)"}
                          </>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setShowBulkPreview(false);
                        setBulkPreviewTopics([]);
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        fontSize: "1.5rem",
                        cursor: "pointer",
                        color: "#64748b",
                      }}
                    >
                      ×
                    </button>
                  </div>
                  
                  {currentQuestion ? (
                    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                      <div style={{
                        padding: "1.5rem",
                        backgroundColor: "#ffffff",
                        borderRadius: "0.5rem",
                        border: "1px solid #e2e8f0",
                        marginBottom: "1rem",
                        flex: 1,
                        overflow: "auto",
                      }}>
                        {renderQuestionByType(
                          editingBulkQuestion || currentQuestion,
                          currentRow.questionType,
                          editingBulkQuestion !== null,
                          editingBulkQuestion !== null ? (value: string) => {
                            try {
                              setEditingBulkQuestion(JSON.parse(value));
                            } catch {}
                          } : undefined
                        )}
                      </div>
                      
                      <div style={{ display: "flex", gap: "0.5rem", justifyContent: "space-between" }}>
                        <div style={{ display: "flex", gap: "0.5rem" }}>
                          <button
                            type="button"
                            onClick={() => {
                              if (prevPos) {
                                setBulkPreviewCurrentTopicIndex(prevPos.topicIndex);
                                setBulkPreviewCurrentRowIndex(prevPos.rowIndex);
                                setBulkPreviewCurrentQuestionIndex(prevPos.questionIndex);
                                setEditingBulkQuestion(null);
                              }
                            }}
                            disabled={!prevPos}
                            style={{
                              padding: "0.5rem 1rem",
                              background: prevPos ? "#3b82f6" : "#94a3b8",
                              border: "none",
                              color: "#ffffff",
                              cursor: prevPos ? "pointer" : "not-allowed",
                              borderRadius: "0.375rem",
                            }}
                          >
                            Previous
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (nextPos) {
                                setBulkPreviewCurrentTopicIndex(nextPos.topicIndex);
                                setBulkPreviewCurrentRowIndex(nextPos.rowIndex);
                                setBulkPreviewCurrentQuestionIndex(nextPos.questionIndex);
                                setEditingBulkQuestion(null);
                              }
                            }}
                            disabled={!nextPos}
                            style={{
                              padding: "0.5rem 1rem",
                              background: nextPos ? "#3b82f6" : "#94a3b8",
                              border: "none",
                              color: "#ffffff",
                              cursor: nextPos ? "pointer" : "not-allowed",
                              borderRadius: "0.375rem",
                            }}
                          >
                            Next
                          </button>
                        </div>
                        
                        <div style={{ display: "flex", gap: "0.5rem" }}>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingBulkQuestion({ ...currentQuestion });
                            }}
                            disabled={!!editingBulkQuestion}
                            style={{
                              padding: "0.5rem 1rem",
                              background: editingBulkQuestion ? "#94a3b8" : "#10b981",
                              border: "none",
                              color: "#ffffff",
                              cursor: editingBulkQuestion ? "not-allowed" : "pointer",
                              borderRadius: "0.375rem",
                            }}
                          >
                            Edit Question
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (!editingBulkQuestion) return;
                              const updatedTopics = bulkPreviewTopics.map(t => {
                                if (t.id === currentTopic.id) {
                                  const updatedRows = t.questionRows.map(r => {
                                    if (r.rowId === currentRow.rowId) {
                                      const updatedQuestions = [...r.questions];
                                      updatedQuestions[bulkPreviewCurrentQuestionIndex] = editingBulkQuestion;
                                      return { ...r, questions: updatedQuestions };
                                    }
                                    return r;
                                  });
                                  return { ...t, questionRows: updatedRows };
                                }
                                return t;
                              });
                              setBulkPreviewTopics(updatedTopics);
                              setTopicsV2(updatedTopics);
                              setEditingBulkQuestion(null);
                            }}
                            disabled={!editingBulkQuestion}
                            style={{
                              padding: "0.5rem 1rem",
                              background: editingBulkQuestion ? "#3b82f6" : "#94a3b8",
                              border: "none",
                              color: "#ffffff",
                              cursor: editingBulkQuestion ? "pointer" : "not-allowed",
                              borderRadius: "0.375rem",
                            }}
                          >
                            Save Question
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              if (!assessmentId || !currentQuestion) return;
                              try {
                                const response = await axios.post("/api/assessments/regenerate-single-question", {
                                  assessmentId: assessmentId,
                                  topicId: currentTopic.id,
                                  rowId: currentRow.rowId,
                                  questionIndex: bulkPreviewCurrentQuestionIndex,
                                });
                                if (response.data?.success) {
                                  const updatedRow = response.data.data.row;
                                  const updatedTopics = bulkPreviewTopics.map(t => {
                                    if (t.id === currentTopic.id) {
                                      const updatedRows = t.questionRows.map(r => r.rowId === currentRow.rowId ? updatedRow : r);
                                      return { ...t, questionRows: updatedRows };
                                    }
                                    return t;
                                  });
                                  setBulkPreviewTopics(updatedTopics);
                                  setTopicsV2(updatedTopics);
                                  setEditingBulkQuestion(null);
                                }
                              } catch (err: any) {
                                console.error("Error regenerating question:", err);
                                setError(err.response?.data?.message || err.message || "Failed to regenerate question");
                              }
                            }}
                            style={{
                              padding: "0.5rem 1rem",
                              background: "#f59e0b",
                              border: "none",
                              color: "#ffffff",
                              cursor: "pointer",
                              borderRadius: "0.375rem",
                            }}
                          >
                            Regenerate This Question
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ padding: "2rem", textAlign: "center", color: "#64748b" }}>
                      {generatingAllQuestions ? (
                        <p>Generating questions... Please wait.</p>
                      ) : (
                        <p>No questions available yet. Questions will appear as they are generated.</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Station 3: Review Questions */}
          {currentStation === 3 && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <div style={{ flex: 1 }}>
              <h1 style={{ marginBottom: "0.5rem", fontSize: "2rem", color: "#1a1625", fontWeight: 700 }}>
                Review Questions
              </h1>
              <p style={{ color: "#6b6678", marginBottom: "2rem", fontSize: "1rem" }}>
                Review questions grouped by type and set time for each question type
              </p>
                </div>
                <button
                  type="button"
                  onClick={handleBackToDashboard}
                  className="btn-secondary"
                  style={{ 
                    marginLeft: "1rem",
                    whiteSpace: "nowrap",
                    padding: "0.75rem 1.5rem",
                    fontSize: "0.875rem"
                  }}
                >
                  Back to Dashboard
                </button>
              </div>

              {/* Toggle for Per-Section Timers */}
              <div style={{ 
                marginBottom: "2rem", 
                padding: "1.5rem", 
                backgroundColor: "#f8fafc", 
                borderRadius: "0.75rem", 
                border: "2px solid #e2e8f0" 
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                  <div>
                    <h3 style={{ margin: 0, marginBottom: "0.5rem", fontSize: "1.125rem", color: "#1a1625", fontWeight: 600 }}>
                      Timer Settings
                    </h3>
                    <p style={{ margin: 0, fontSize: "0.875rem", color: "#64748b" }}>
                      {enablePerSectionTimers 
                        ? "Each question type will have its own timer. Sections will lock when their timer expires."
                        : "Only the overall assessment schedule time will apply. No per-section timers."}
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    <button
                      type="button"
                      onClick={() => setEnablePerSectionTimers(true)}
                      style={{
                        padding: "0.75rem 1.5rem",
                        border: `2px solid ${enablePerSectionTimers ? "#10b981" : "#e2e8f0"}`,
                        borderRadius: "0.5rem",
                        backgroundColor: enablePerSectionTimers ? "#10b981" : "#ffffff",
                        color: enablePerSectionTimers ? "#ffffff" : "#64748b",
                        fontWeight: 600,
                        cursor: "pointer",
                        fontSize: "0.875rem",
                        transition: "all 0.2s",
                      }}
                    >
                      Enable Per-Section Timers
                    </button>
                    <button
                      type="button"
                      onClick={() => setEnablePerSectionTimers(false)}
                      style={{
                        padding: "0.75rem 1.5rem",
                        border: `2px solid ${!enablePerSectionTimers ? "#3b82f6" : "#e2e8f0"}`,
                        borderRadius: "0.5rem",
                        backgroundColor: !enablePerSectionTimers ? "#3b82f6" : "#ffffff",
                        color: !enablePerSectionTimers ? "#ffffff" : "#64748b",
                        fontWeight: 600,
                        cursor: "pointer",
                        fontSize: "0.875rem",
                        transition: "all 0.2s",
                      }}
                    >
                      Use Schedule Time Only
                    </button>
                  </div>
                </div>
              </div>

              {(() => {
                // Extract all questions from topicsV2
                const allReviewQuestions: Array<{
                  question: any;
                  questionType: string;
                  difficulty: string;
                  topicId: string;
                  rowId: string;
                  questionIndex: number;
                  topicLabel: string;
                  uniqueId: string;
                }> = [];
                
                // Aggregate questions from ALL topics including:
                // - System-generated topics
                // - Custom-added topics
                // - Topics previewed individually
                // - Topics that participated in preview-all
                topicsV2.forEach((topic) => {
                  topic.questionRows.forEach((row) => {
                    // Include questions if they exist and status is "generated" or "completed"
                    // "completed" status is used for custom topics generated via row preview
                    const rowStatus = row.status;
                    const isGeneratedOrCompleted = rowStatus === "generated" || rowStatus === "completed";
                    if (row.questions && row.questions.length > 0 && isGeneratedOrCompleted) {
                      row.questions.forEach((question, qIdx) => {
                        allReviewQuestions.push({
                          question,
                          questionType: row.questionType,
                          difficulty: row.difficulty,
                          topicId: topic.id,
                          rowId: row.rowId,
                          questionIndex: qIdx,
                          topicLabel: topic.label,
                          uniqueId: `${topic.id}_${row.rowId}_${qIdx}`,
                        });
                      });
                    }
                  });
                });
                
                if (allReviewQuestions.length === 0) {
                  return (
                    <div style={{ textAlign: "center", padding: "3rem", color: "#64748b" }}>
                      <p>No questions generated yet.</p>
                      <p style={{ fontSize: "0.875rem", marginTop: "0.5rem" }}>
                        Generate questions from the Configure Topics page (Station 2).
                      </p>
                    </div>
                  );
                }
                
                // Group questions by type
                const questionsByType: {
                  MCQ: typeof allReviewQuestions;
                  Subjective: typeof allReviewQuestions;
                  PseudoCode: typeof allReviewQuestions;
                  Coding: typeof allReviewQuestions;
                } = {
                  MCQ: [],
                  Subjective: [],
                  PseudoCode: [],
                  Coding: [],
                };
                
                allReviewQuestions.forEach((q) => {
                  const type = q.questionType as keyof typeof questionsByType;
                  if (questionsByType[type]) {
                    questionsByType[type].push(q);
                  }
                });
                
                // Calculate AI estimated total time (sum of all question times)
                const totalAiEstimatedTime = allReviewQuestions.reduce((total, q) => {
                  const baseTime = getBaseTimePerQuestion(q.questionType);
                  const multiplier = getDifficultyMultiplier(q.difficulty);
                  return total + (baseTime * multiplier);
                }, 0);
                const totalAiEstimatedMinutes = Math.ceil(totalAiEstimatedTime / 60);
                
                // Calculate total time from section timers (for per-section mode)
                const totalCalculatedTime = Object.values(sectionTimers).reduce((sum, time) => sum + time, 0);
                
                // Calculate schedule time in minutes (if available)
                const scheduleTimeMinutes = startTime && endTime 
                  ? Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / (1000 * 60))
                  : 0;
                
                // Show warning if schedule time is less than AI estimated (but don't block)
                const showScheduleTimeWarning = !enablePerSectionTimers && 
                  scheduleTimeMinutes > 0 && 
                  scheduleTimeMinutes < totalAiEstimatedMinutes;
                
                return (
                  <div style={{ marginBottom: "2rem" }}>
                    {/* AI Estimated Time Display (for Schedule Time Only mode) */}
                    {!enablePerSectionTimers && (
                      <div style={{
                        marginBottom: "1.5rem",
                        padding: "1.5rem",
                        backgroundColor: "#f8fafc",
                        borderRadius: "0.75rem",
                        border: "1px solid #e2e8f0",
                      }}>
                        <div style={{ marginBottom: "1rem" }}>
                          <h3 style={{ margin: 0, marginBottom: "0.5rem", fontSize: "1.125rem", color: "#1a1625", fontWeight: 600 }}>
                            AI Estimated Total Time
                          </h3>
                          <p style={{ margin: 0, fontSize: "1.5rem", color: "#3b82f6", fontWeight: 700 }}>
                            {formatTime(totalAiEstimatedMinutes)}
                          </p>
                          <p style={{ margin: "0.5rem 0 0 0", fontSize: "0.875rem", color: "#64748b" }}>
                            Based on question types and difficulty levels
                          </p>
                        </div>
                        
                        {/* Warning if schedule time is less than AI estimated */}
                        {showScheduleTimeWarning && (
                          <div style={{
                            marginTop: "1rem",
                            padding: "0.75rem",
                            backgroundColor: "#fef3c7",
                            border: "1px solid #fbbf24",
                            borderRadius: "0.5rem",
                          }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                              <span style={{ fontSize: "1rem" }}>⚠️</span>
                              <span style={{ fontSize: "0.875rem", color: "#92400e" }}>
                                Schedule time is lower than AI estimated time. Candidates may need more time to complete all questions.
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    
                    {/* Question Type Sections */}
                    {(["MCQ", "Subjective", "PseudoCode", "Coding"] as const).map((questionType) => {
                      const typeQuestions = questionsByType[questionType];
                      if (typeQuestions.length === 0) return null;
                      
                      const sectionTimer = sectionTimers[questionType];
                      const canEditTimer = enablePerSectionTimers;
                      
                      return (
                        <div key={questionType} style={{ marginBottom: "2rem" }}>
                          <div style={{ 
                            display: "flex", 
                            justifyContent: "space-between", 
                            alignItems: "center",
                            marginBottom: "1rem",
                            padding: "1rem",
                            backgroundColor: "#f8fafc",
                            borderRadius: "0.5rem",
                            border: "1px solid #e2e8f0"
                          }}>
                            <div>
                              <h3 style={{ margin: 0, fontSize: "1.25rem", color: "#1a1625", fontWeight: 700 }}>
                                {questionType} Questions
                              </h3>
                              <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.875rem", color: "#64748b" }}>
                                {typeQuestions.length} question{typeQuestions.length !== 1 ? "s" : ""}
                                {canEditTimer && ` • Auto-calculated time: ${formatTime(sectionTimer)}`}
                              </p>
                            </div>
                            {canEditTimer && (
                              <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", color: "#1e293b", fontWeight: 600 }}>
                                  Time (minutes):
                                  <input
                                    type="number"
                                    min="1"
                                    value={sectionTimer}
                                    onChange={(e) => {
                                      const newTime = parseInt(e.target.value) || 1;
                                      setSectionTimers((prev) => ({
                                        ...prev,
                                        [questionType]: newTime,
                                      }));
                                    }}
                                    style={{
                                      width: "80px",
                                      padding: "0.5rem",
                                      border: "1px solid #e2e8f0",
                                      borderRadius: "0.5rem",
                                      fontSize: "0.875rem",
                                    }}
                                  />
                                </label>
                              </div>
                            )}
                          </div>

                          {/* Questions Table for this type */}
                          <div style={{ overflowX: "auto", marginBottom: "1.5rem" }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", backgroundColor: "#ffffff", borderRadius: "0.5rem", overflow: "hidden", border: "1px solid #e2e8f0" }}>
                              <thead>
                                <tr style={{ backgroundColor: "#f8fafc" }}>
                                  <th style={{ padding: "1rem", textAlign: "left", borderBottom: "2px solid #e2e8f0", fontWeight: 600, color: "#1e293b" }}>
                                    Question
                                  </th>
                                  <th style={{ padding: "1rem", textAlign: "left", borderBottom: "2px solid #e2e8f0", fontWeight: 600, color: "#1e293b", width: "100px" }}>
                                    Difficulty
                                  </th>
                                  <th style={{ padding: "1rem", textAlign: "left", borderBottom: "2px solid #e2e8f0", fontWeight: 600, color: "#1e293b", width: "120px" }}>
                                    Timer (min)
                                  </th>
                                  <th style={{ padding: "1rem", textAlign: "center", borderBottom: "2px solid #e2e8f0", fontWeight: 600, color: "#1e293b", width: "100px" }}>
                                    Score
                                  </th>
                                  <th style={{ padding: "1rem", textAlign: "center", borderBottom: "2px solid #e2e8f0", fontWeight: 600, color: "#1e293b", width: "150px" }}>
                                    Actions
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {typeQuestions.map((qData, idx) => {
                                  const questionText = getQuestionText(qData.question, questionType);
                                  const { truncated, isTruncated } = truncateText(questionText, 80);
                                  const questionId = qData.uniqueId;
                                  
                                  return (
                                    <tr key={questionId} style={{ borderBottom: "1px solid #e2e8f0" }}>
                                      <td style={{ padding: "1rem", maxWidth: "500px" }}>
                                        <div style={{ marginBottom: "0.5rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                                          <span
                                            style={{
                                              backgroundColor: "#6953a3",
                                              color: "#ffffff",
                                              padding: "0.25rem 0.75rem",
                                              borderRadius: "9999px",
                                              fontSize: "0.75rem",
                                              fontWeight: 700,
                                            }}
                                          >
                                            Q{idx + 1}
                                          </span>
                                        </div>
                                        <div style={{ fontSize: "0.875rem", color: "#1e293b", lineHeight: "1.6", marginBottom: "0.5rem" }}>
                                          {truncated}
                                          {isTruncated && (
                                            <button
                                              type="button"
                                              onClick={() => setExpandedQuestionId(questionId)}
                                              style={{
                                                marginLeft: "0.5rem",
                                                background: "none",
                                                border: "none",
                                                color: "#3b82f6",
                                                cursor: "pointer",
                                                textDecoration: "underline",
                                                fontSize: "0.875rem",
                                              }}
                                            >
                                              Read more
                                            </button>
                                          )}
                                        </div>
                                        <span style={{ fontSize: "0.75rem", color: "#64748b", display: "block" }}>
                                          Topic: {qData.topicLabel}
                                        </span>
                                      </td>
                                      <td style={{ padding: "1rem" }}>
                                        <span
                                          style={{
                                            backgroundColor: qData.difficulty === "Easy" ? "#d1fae5" : qData.difficulty === "Medium" ? "#fef3c7" : "#fee2e2",
                                            color: qData.difficulty === "Easy" ? "#065f46" : qData.difficulty === "Medium" ? "#92400e" : "#991b1b",
                                            padding: "0.25rem 0.75rem",
                                            borderRadius: "9999px",
                                            fontSize: "0.75rem",
                                            fontWeight: 500,
                                          }}
                                        >
                                          {qData.difficulty}
                                        </span>
                                      </td>
                                      <td style={{ padding: "1rem" }}>
                                        {enablePerSectionTimers ? (
                                          <input
                                            type="number"
                                            min="1"
                                            value={Math.ceil((getBaseTimePerQuestion(questionType) * getDifficultyMultiplier(qData.difficulty)) / 60)}
                                            readOnly
                                            style={{
                                              width: "100%",
                                              padding: "0.5rem",
                                              border: "1px solid #e2e8f0",
                                              borderRadius: "0.5rem",
                                              fontSize: "0.875rem",
                                              backgroundColor: "#f1f5f9",
                                              cursor: "not-allowed",
                                            }}
                                          />
                                        ) : (
                                          <span style={{ fontSize: "0.875rem", color: "#64748b" }}>
                                            N/A (Schedule Time Only)
                                          </span>
                                        )}
                                      </td>
                                      <td style={{ padding: "1rem", textAlign: "center" }}>
                                        <span style={{ 
                                          fontSize: "1rem", 
                                          fontWeight: 600, 
                                          color: "#1e293b",
                                          display: "inline-block",
                                          padding: "0.25rem 0.75rem",
                                          backgroundColor: "#f1f5f9",
                                          borderRadius: "0.375rem",
                                        }}>
                                          {scoringRules[questionType as keyof typeof scoringRules] || 0} mark{scoringRules[questionType as keyof typeof scoringRules] !== 1 ? "s" : ""}
                                        </span>
                                      </td>
                                      <td style={{ padding: "1rem", textAlign: "center" }}>
                                        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center" }}>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setExpandedQuestionId(questionId);
                                              setEditingReviewQuestion({ ...qData, questionType });
                                            }}
                                            style={{
                                              padding: "0.25rem 0.75rem",
                                              background: "#3b82f6",
                                              border: "none",
                                              color: "#ffffff",
                                              cursor: "pointer",
                                              fontSize: "0.75rem",
                                              borderRadius: "0.375rem",
                                            }}
                                            title="Edit question"
                                          >
                                            Edit
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              if (confirm("Are you sure you want to remove this question?")) {
                                                handleRemoveQuestionInReview(qData.topicId, qData.rowId, qData.questionIndex);
                                              }
                                            }}
                                            style={{
                                              padding: "0.25rem 0.75rem",
                                              background: "#ef4444",
                                              border: "none",
                                              color: "#ffffff",
                                              cursor: "pointer",
                                              fontSize: "0.75rem",
                                              borderRadius: "0.375rem",
                                            }}
                                            title="Remove question"
                                          >
                                            Remove
                                          </button>
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    })}
                    
                    {/* Total Summary */}
                    <div style={{ 
                      display: "flex", 
                      justifyContent: "space-between", 
                      alignItems: "center",
                      padding: "1rem 1.5rem",
                      backgroundColor: "#f8fafc",
                      borderRadius: "0.5rem",
                      border: "1px solid #e2e8f0",
                      marginTop: "1rem"
                    }}>
                      <div>
                        <span style={{ color: "#64748b", fontSize: "0.875rem", marginRight: "0.5rem" }}>Total Questions:</span>
                        <span style={{ color: "#1e293b", fontSize: "1.125rem", fontWeight: 700 }}>
                          {allReviewQuestions.length}
                        </span>
                      </div>
                      {enablePerSectionTimers && (
                        <div>
                          <span style={{ color: "#64748b", fontSize: "0.875rem", marginRight: "0.5rem" }}>Total Time (All Sections):</span>
                          <span style={{ color: "#1e293b", fontSize: "1.125rem", fontWeight: 700 }}>
                            {formatTime(totalCalculatedTime)}
                          </span>
                        </div>
                      )}
                      {!enablePerSectionTimers && (
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", alignItems: "flex-end" }}>
                          <div>
                            <span style={{ color: "#64748b", fontSize: "0.875rem", marginRight: "0.5rem" }}>AI Estimated Total Time:</span>
                            <span style={{ color: "#3b82f6", fontSize: "1.125rem", fontWeight: 700 }}>
                              {formatTime(totalAiEstimatedMinutes)}
                            </span>
                          </div>
                          {scheduleTimeMinutes > 0 && (
                            <div>
                              <span style={{ color: "#64748b", fontSize: "0.875rem", marginRight: "0.5rem" }}>Schedule Time:</span>
                              <span style={{ color: "#1e293b", fontSize: "1.125rem", fontWeight: 700 }}>
                                {formatTime(scheduleTimeMinutes)}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
              
              {/* Read More / Edit Question Modal */}
              {expandedQuestionId && (() => {
                const qData = (() => {
                  for (const topic of topicsV2) {
                    for (const row of topic.questionRows) {
                      if (row.questions && row.questions.length > 0) {
                        for (let i = 0; i < row.questions.length; i++) {
                          const id = `${topic.id}_${row.rowId}_${i}`;
                          if (id === expandedQuestionId) {
                            return {
                              question: row.questions[i],
                              questionType: row.questionType,
                              difficulty: row.difficulty,
                              topicId: topic.id,
                              rowId: row.rowId,
                              questionIndex: i,
                              topicLabel: topic.label,
                            };
                          }
                        }
                      }
                    }
                  }
                  return null;
                })();
                
                if (!qData) return null;
                
                const isEditing = editingReviewQuestion && editingReviewQuestion.uniqueId === expandedQuestionId;
                
                return (
                  <div style={{
                    position: "fixed",
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: "rgba(0, 0, 0, 0.5)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    zIndex: 1000,
                    padding: "2rem",
                  }}
                  onClick={(e) => {
                    if (e.target === e.currentTarget) {
                      setExpandedQuestionId(null);
                      setEditingReviewQuestion(null);
                    }
                  }}
                  >
                    <div style={{
                      backgroundColor: "#ffffff",
                      borderRadius: "0.75rem",
                      padding: "2rem",
                      maxWidth: "800px",
                      maxHeight: "90vh",
                      overflow: "auto",
                      width: "100%",
                      boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)",
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
                        <h2 style={{ margin: 0, fontSize: "1.5rem", color: "#1a1625", fontWeight: 700 }}>
                          {qData.topicLabel} - {qData.questionType}
                        </h2>
                        <button
                          type="button"
                          onClick={() => {
                            setExpandedQuestionId(null);
                            setEditingReviewQuestion(null);
                          }}
                          style={{
                            background: "none",
                            border: "none",
                            fontSize: "1.5rem",
                            cursor: "pointer",
                            color: "#64748b",
                            padding: "0.25rem 0.5rem",
                          }}
                        >
                          ×
                        </button>
                      </div>
                      
                      <div style={{ marginBottom: "1.5rem" }}>
                        {renderQuestionByType(
                          isEditing ? editingReviewQuestion.question : qData.question,
                          qData.questionType,
                          isEditing,
                          isEditing ? (value: string) => {
                            try {
                              const parsed = JSON.parse(value);
                              setEditingReviewQuestion({ ...editingReviewQuestion, question: parsed });
                            } catch {}
                          } : undefined
                        )}
                      </div>
                      
                      <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                        {!isEditing && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingReviewQuestion({ ...qData, uniqueId: expandedQuestionId });
                            }}
                            style={{
                              padding: "0.5rem 1rem",
                              background: "#10b981",
                              border: "none",
                              color: "#ffffff",
                              cursor: "pointer",
                              borderRadius: "0.375rem",
                              fontSize: "0.875rem",
                            }}
                          >
                            Edit Question
                          </button>
                        )}
                        {isEditing && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingReviewQuestion(null);
                              }}
                              style={{
                                padding: "0.5rem 1rem",
                                background: "#94a3b8",
                                border: "none",
                                color: "#ffffff",
                                cursor: "pointer",
                                borderRadius: "0.375rem",
                                fontSize: "0.875rem",
                              }}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                if (!assessmentId || !editingReviewQuestion) return;
                                try {
                                  const response = await axios.put("/api/assessments/update-single-question", {
                                    assessmentId,
                                    topicId: qData.topicId,
                                    rowId: qData.rowId,
                                    questionIndex: qData.questionIndex,
                                    question: editingReviewQuestion.question,
                                  });
                                  if (response.data?.success) {
                                    const updatedRow = response.data.data.row;
                                    setTopicsV2((prev) => prev.map(t => {
                                      if (t.id === qData.topicId) {
                                        return {
                                          ...t,
                                          questionRows: t.questionRows.map(r => r.rowId === qData.rowId ? updatedRow : r),
                                        };
                                      }
                                      return t;
                                    }));
                                    setEditingReviewQuestion(null);
                                  }
                                } catch (err: any) {
                                  console.error("Error updating question:", err);
                                  setError(err.response?.data?.message || err.message || "Failed to update question");
                                }
                              }}
                              style={{
                                padding: "0.5rem 1rem",
                                background: "#3b82f6",
                                border: "none",
                                color: "#ffffff",
                                cursor: "pointer",
                                borderRadius: "0.375rem",
                                fontSize: "0.875rem",
                              }}
                            >
                              Save
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setExpandedQuestionId(null);
                            setEditingReviewQuestion(null);
                          }}
                          style={{
                            padding: "0.5rem 1rem",
                            background: "#64748b",
                            border: "none",
                            color: "#ffffff",
                            cursor: "pointer",
                            borderRadius: "0.375rem",
                            fontSize: "0.875rem",
                          }}
                        >
                          Close
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Pass Percentage Setting */}
              <div style={{ 
                marginTop: "2rem", 
                padding: "1.5rem", 
                backgroundColor: "#f8fafc", 
                borderRadius: "0.75rem", 
                border: "2px solid #e2e8f0" 
              }}>
                <h3 style={{ marginBottom: "1rem", fontSize: "1.125rem", color: "#1a1625", fontWeight: 600 }}>
                  Pass Percentage
                </h3>
                <div style={{ marginBottom: "1rem" }}>
                  <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b", fontSize: "0.875rem" }}>
                    Pass Percentage (%)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={passPercentage}
                    onChange={(e) => {
                      const value = parseInt(e.target.value) || 60;
                      const clampedValue = Math.min(100, Math.max(1, value));
                      setPassPercentage(clampedValue);
                    }}
                    placeholder="Enter pass percentage (e.g., 60)"
                    style={{
                      width: "200px",
                      padding: "0.75rem",
                      border: "1px solid #e2e8f0",
                      borderRadius: "0.5rem",
                      fontSize: "1rem",
                    }}
                  />
                  <p style={{ fontSize: "0.875rem", color: "#64748b", marginTop: "0.5rem" }}>
                    Candidates need to score at least {passPercentage}% to pass the assessment.
                  </p>
                </div>
              </div>

              {/* Navigation Buttons */}
              <div style={{ marginTop: "2rem", paddingTop: "2rem", borderTop: "2px solid #e2e8f0", display: "flex", gap: "1rem" }}>
                <button
                  type="button"
                  onClick={() => {
                    setHasVisitedReviewStation(true);
                    setCurrentStation(2);
                  }}
                  className="btn-secondary"
                  style={{ flex: 1 }}
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCurrentStation(4);
                  }}
                  className="btn-primary"
                  style={{ flex: 1 }}
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {/* Station 4: Schedule Exam */}
          {currentStation === 4 && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <div style={{ flex: 1 }}>
              <h1 style={{ marginBottom: "0.5rem", fontSize: "2rem", color: "#1a1625", fontWeight: 700 }}>
                Schedule Exam
              </h1>
              <p style={{ color: "#6b6678", marginBottom: "2rem", fontSize: "1rem" }}>
                Set the start and end time for the assessment (Indian Standard Time - IST)
              </p>
                </div>
                <button
                  type="button"
                  onClick={handleBackToDashboard}
                  className="btn-secondary"
                  style={{ 
                    marginLeft: "1rem",
                    whiteSpace: "nowrap",
                    padding: "0.75rem 1.5rem",
                    fontSize: "0.875rem"
                  }}
                >
                  Back to Dashboard
                </button>
              </div>

              <div style={{ marginBottom: "2rem" }}>
                <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
                  Start Time (IST) *
                </label>
                <input
                  type="datetime-local"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  required
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    border: "1px solid #e2e8f0",
                    borderRadius: "0.5rem",
                    fontSize: "1rem",
                  }}
                />
                <p style={{ fontSize: "0.875rem", color: "#64748b", marginTop: "0.5rem" }}>
                  Indian Standard Time (IST) - UTC+5:30
                </p>
              </div>

              <div style={{ marginBottom: "2rem" }}>
                <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
                  End Time (IST) *
                </label>
                <input
                  type="datetime-local"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  required
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    border: `1px solid ${startTime && endTime && new Date(endTime) <= new Date(startTime) ? "#ef4444" : "#e2e8f0"}`,
                    borderRadius: "0.5rem",
                    fontSize: "1rem",
                  }}
                />
                <p style={{ fontSize: "0.875rem", color: "#64748b", marginTop: "0.5rem" }}>
                  Indian Standard Time (IST) - UTC+5:30
                </p>
                {startTime && endTime && new Date(endTime) <= new Date(startTime) && (
                  <p style={{ fontSize: "0.875rem", color: "#dc2626", marginTop: "0.5rem", fontWeight: 600 }}>
                    ⚠️ Please choose an end time greater than the start time
                  </p>
                )}
              </div>

              {/* Error Message for Invalid Time Range */}
              {startTime && endTime && new Date(endTime) <= new Date(startTime) && (
                <div style={{ 
                  marginBottom: "1.5rem",
                  padding: "1rem",
                  backgroundColor: "#fef2f2",
                  border: "2px solid #ef4444",
                  borderRadius: "0.5rem"
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                    <span style={{ fontSize: "1.25rem" }}>⚠️</span>
                    <strong style={{ color: "#dc2626" }}>
                      Invalid Time Range
                    </strong>
                  </div>
                  <div style={{ fontSize: "0.875rem", color: "#64748b", marginLeft: "1.75rem" }}>
                    <div style={{ color: "#dc2626", fontWeight: 600 }}>
                      Please choose an end time that is greater than the start time.
                    </div>
                  </div>
                </div>
              )}

              {/* Validation Message - Mode 1: Enable Per-Section Timers */}
              {startTime && endTime && new Date(endTime) > new Date(startTime) && enablePerSectionTimers && (() => {
                const scheduledWindow = (new Date(endTime).getTime() - new Date(startTime).getTime()) / (1000 * 60); // in minutes
                // Use sectionTimers (from Review Questions) instead of questionTypeTimes
                const totalTimeFromSections = Object.values(sectionTimers).reduce((sum, time) => sum + time, 0);
                const isValid = totalTimeFromSections <= scheduledWindow;
                
                return (
                  <div style={{ 
                    marginBottom: "1.5rem",
                    padding: "1rem",
                    backgroundColor: isValid ? "#f0fdf4" : "#fef2f2",
                    border: `2px solid ${isValid ? "#10b981" : "#ef4444"}`,
                    borderRadius: "0.5rem"
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                      <span style={{ fontSize: "1.25rem" }}>{isValid ? "✓" : "⚠️"}</span>
                      <strong style={{ color: isValid ? "#059669" : "#dc2626" }}>
                        {isValid ? "Schedule Duration is Valid" : "Section timers exceed the scheduled exam window"}
                      </strong>
                    </div>
                    <div style={{ fontSize: "0.875rem", color: "#64748b", marginLeft: "1.75rem" }}>
                      <div>Total Section Time: <strong>{totalTimeFromSections} minutes</strong></div>
                      <div>Scheduled Window: <strong>{Math.round(scheduledWindow)} minutes</strong></div>
                      <div style={{ marginTop: "0.5rem", fontWeight: 600, color: isValid ? "#059669" : "#dc2626" }}>
                        Status: {isValid ? "Valid" : "Invalid"}
                      </div>
                      {!isValid && (
                        <div style={{ color: "#dc2626", marginTop: "0.5rem", fontWeight: 600 }}>
                          ⚠️ Section timers ({totalTimeFromSections} minutes) exceed the scheduled window ({Math.round(scheduledWindow)} minutes). Please increase the scheduled window or reduce section timers.
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
              
              {/* Validation Message - Mode 2: Use Schedule Time Only */}
              {startTime && endTime && new Date(endTime) > new Date(startTime) && !enablePerSectionTimers && (() => {
                const scheduledWindow = (new Date(endTime).getTime() - new Date(startTime).getTime()) / (1000 * 60); // in minutes
                
                // Calculate AI estimated total time (EXACT same logic as in Review Questions)
                // Aggregate questions from ALL topics including:
                // - System-generated topics
                // - Custom-added topics
                // - Topics previewed individually
                // - Topics that participated in preview-all
                const allReviewQuestions: Array<{
                  question: any;
                  questionType: string;
                  difficulty: string;
                }> = [];
                
                topicsV2.forEach((topic) => {
                  topic.questionRows.forEach((row) => {
                    // Include questions if they exist and status is "generated" or "completed"
                    // "completed" status is used for custom topics generated via row preview
                    const rowStatus = row.status;
                    const isGeneratedOrCompleted = rowStatus === "generated" || rowStatus === "completed";
                    if (row.questions && row.questions.length > 0 && isGeneratedOrCompleted) {
                      row.questions.forEach((question) => {
                        allReviewQuestions.push({
                          question,
                          questionType: row.questionType,
                          difficulty: row.difficulty,
                        });
                      });
                    }
                  });
                });
                
                const totalAiEstimatedTime = allReviewQuestions.reduce((total, q) => {
                  const baseTime = getBaseTimePerQuestion(q.questionType);
                  const multiplier = getDifficultyMultiplier(q.difficulty);
                  return total + (baseTime * multiplier);
                }, 0);
                const totalAiEstimatedMinutes = Math.ceil(totalAiEstimatedTime / 60);
                
                // Use AI Estimated Total Time as the exam duration
                const examDuration = totalAiEstimatedMinutes > 0 ? totalAiEstimatedMinutes : Math.round(scheduledWindow);
                const isValid = examDuration <= scheduledWindow;
                
                return (
                  <div style={{ 
                    marginBottom: "1.5rem",
                    padding: "1rem",
                    backgroundColor: isValid ? "#f0fdf4" : "#fef2f2",
                    border: `2px solid ${isValid ? "#10b981" : "#ef4444"}`,
                    borderRadius: "0.5rem"
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                      <span style={{ fontSize: "1.25rem" }}>{isValid ? "✓" : "⚠️"}</span>
                      <strong style={{ color: isValid ? "#059669" : "#dc2626" }}>
                        {isValid ? "Schedule Duration is Valid" : "Exam duration exceeds the scheduled window"}
                      </strong>
                    </div>
                    <div style={{ fontSize: "0.875rem", color: "#64748b", marginLeft: "1.75rem" }}>
                      <div>AI Estimated Total Time: <strong>{examDuration} minutes</strong></div>
                      <div>Scheduled Window: <strong>{Math.round(scheduledWindow)} minutes</strong></div>
                      <div style={{ marginTop: "0.5rem", fontWeight: 600, color: isValid ? "#059669" : "#dc2626" }}>
                        Status: {isValid ? "Valid" : "Invalid"}
                      </div>
                      {isValid && (
                        <div style={{ marginTop: "0.5rem", fontSize: "0.875rem", color: "#64748b" }}>
                          Candidates can take the exam during the scheduled window. Each candidate will have {examDuration} minutes to complete the exam.
                        </div>
                      )}
                      {!isValid && (
                        <div style={{ color: "#dc2626", marginTop: "0.5rem", fontWeight: 600 }}>
                          ⚠️ AI Estimated Total Time ({examDuration} minutes) exceeds the scheduled window ({Math.round(scheduledWindow)} minutes). Please increase the scheduled window.
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Proctoring Settings Section */}
              <div style={{ 
                marginTop: "2rem", 
                padding: "1.5rem", 
                backgroundColor: "#f8fafc", 
                borderRadius: "0.75rem", 
                border: "2px solid #e2e8f0" 
              }}>
                <h3 style={{ marginBottom: "1rem", fontSize: "1.25rem", color: "#1a1625", fontWeight: 700 }}>
                  Proctoring Settings
                </h3>
                <p style={{ marginBottom: "1.5rem", fontSize: "0.875rem", color: "#64748b" }}>
                  Enable the proctoring features you want to use during the exam. Only enabled modules will run and generate logs.
                </p>
                
                <div style={{ display: "grid", gap: "1rem" }}>
                  {/* Multiple Face Detection */}
                  <div style={{ 
                    display: "flex", 
                    alignItems: "flex-start", 
                    gap: "0.75rem",
                    padding: "1rem",
                    backgroundColor: "#ffffff",
                    borderRadius: "0.5rem",
                    border: "1px solid #e2e8f0"
                  }}>
                    <input
                      type="checkbox"
                      id="multiFaceDetection"
                      checked={proctoringSettings.multiFaceDetection}
                      onChange={(e) => setProctoringSettings(prev => ({ ...prev, multiFaceDetection: e.target.checked }))}
                      style={{ marginTop: "0.25rem", width: "18px", height: "18px", cursor: "pointer" }}
                    />
                    <div style={{ flex: 1 }}>
                      <label htmlFor="multiFaceDetection" style={{ display: "block", fontWeight: 600, color: "#1e293b", marginBottom: "0.25rem", cursor: "pointer" }}>
                        Multiple Face Detection
                      </label>
                      <p style={{ fontSize: "0.875rem", color: "#64748b", margin: 0 }}>
                        Detects if multiple faces appear in the camera feed, indicating potential cheating or unauthorized assistance.
                      </p>
                    </div>
                  </div>

                  {/* Full-Screen Monitoring */}
                  <div style={{ 
                    display: "flex", 
                    alignItems: "flex-start", 
                    gap: "0.75rem",
                    padding: "1rem",
                    backgroundColor: "#ffffff",
                    borderRadius: "0.5rem",
                    border: "1px solid #e2e8f0"
                  }}>
                    <input
                      type="checkbox"
                      id="fullscreenMonitoring"
                      checked={proctoringSettings.fullscreenMonitoring}
                      onChange={(e) => setProctoringSettings(prev => ({ ...prev, fullscreenMonitoring: e.target.checked }))}
                      style={{ marginTop: "0.25rem", width: "18px", height: "18px", cursor: "pointer" }}
                    />
                    <div style={{ flex: 1 }}>
                      <label htmlFor="fullscreenMonitoring" style={{ display: "block", fontWeight: 600, color: "#1e293b", marginBottom: "0.25rem", cursor: "pointer" }}>
                        Full-Screen Monitoring
                      </label>
                      <p style={{ fontSize: "0.875rem", color: "#64748b", margin: 0 }}>
                        Monitors when candidates exit fullscreen mode, which may indicate they are switching to other applications.
                      </p>
                    </div>
                  </div>

                  {/* Copy–Paste Blocking */}
                  <div style={{ 
                    display: "flex", 
                    alignItems: "flex-start", 
                    gap: "0.75rem",
                    padding: "1rem",
                    backgroundColor: "#ffffff",
                    borderRadius: "0.5rem",
                    border: "1px solid #e2e8f0"
                  }}>
                    <input
                      type="checkbox"
                      id="copyPasteBlocking"
                      checked={proctoringSettings.copyPasteBlocking}
                      onChange={(e) => setProctoringSettings(prev => ({ ...prev, copyPasteBlocking: e.target.checked }))}
                      style={{ marginTop: "0.25rem", width: "18px", height: "18px", cursor: "pointer" }}
                    />
                    <div style={{ flex: 1 }}>
                      <label htmlFor="copyPasteBlocking" style={{ display: "block", fontWeight: 600, color: "#1e293b", marginBottom: "0.25rem", cursor: "pointer" }}>
                        Copy–Paste Blocking
                      </label>
                      <p style={{ fontSize: "0.875rem", color: "#64748b", margin: 0 }}>
                        Blocks copy and paste operations during the exam to prevent candidates from copying answers or external content.
                      </p>
                    </div>
                  </div>

                  {/* Tab Switching Detection */}
                  <div style={{ 
                    display: "flex", 
                    alignItems: "flex-start", 
                    gap: "0.75rem",
                    padding: "1rem",
                    backgroundColor: "#ffffff",
                    borderRadius: "0.5rem",
                    border: "1px solid #e2e8f0"
                  }}>
                    <input
                      type="checkbox"
                      id="tabSwitchDetection"
                      checked={proctoringSettings.tabSwitchDetection}
                      onChange={(e) => setProctoringSettings(prev => ({ ...prev, tabSwitchDetection: e.target.checked }))}
                      style={{ marginTop: "0.25rem", width: "18px", height: "18px", cursor: "pointer" }}
                    />
                    <div style={{ flex: 1 }}>
                      <label htmlFor="tabSwitchDetection" style={{ display: "block", fontWeight: 600, color: "#1e293b", marginBottom: "0.25rem", cursor: "pointer" }}>
                        Tab Switching Detection
                      </label>
                      <p style={{ fontSize: "0.875rem", color: "#64748b", margin: 0 }}>
                        Detects when candidates switch browser tabs or windows, which may indicate they are accessing unauthorized resources.
                      </p>
                    </div>
                  </div>

                  {/* Frame Capture + Face Matching */}
                  <div style={{ 
                    display: "flex", 
                    alignItems: "flex-start", 
                    gap: "0.75rem",
                    padding: "1rem",
                    backgroundColor: "#ffffff",
                    borderRadius: "0.5rem",
                    border: "1px solid #e2e8f0"
                  }}>
                    <input
                      type="checkbox"
                      id="frameMatchRecognition"
                      checked={proctoringSettings.frameMatchRecognition}
                      onChange={(e) => setProctoringSettings(prev => ({ ...prev, frameMatchRecognition: e.target.checked }))}
                      style={{ marginTop: "0.25rem", width: "18px", height: "18px", cursor: "pointer" }}
                    />
                    <div style={{ flex: 1 }}>
                      <label htmlFor="frameMatchRecognition" style={{ display: "block", fontWeight: 600, color: "#1e293b", marginBottom: "0.25rem", cursor: "pointer" }}>
                        Frame Capture + Face Matching
                      </label>
                      <p style={{ fontSize: "0.875rem", color: "#64748b", margin: 0 }}>
                        Captures frames periodically and matches faces to detect if the same person is taking the exam throughout the session.
                      </p>
                    </div>
                  </div>

                  {/* External Device Detection */}
                  <div style={{ 
                    display: "flex", 
                    alignItems: "flex-start", 
                    gap: "0.75rem",
                    padding: "1rem",
                    backgroundColor: "#ffffff",
                    borderRadius: "0.5rem",
                    border: "1px solid #e2e8f0"
                  }}>
                    <input
                      type="checkbox"
                      id="externalDeviceDetection"
                      checked={proctoringSettings.externalDeviceDetection}
                      onChange={(e) => setProctoringSettings(prev => ({ ...prev, externalDeviceDetection: e.target.checked }))}
                      style={{ marginTop: "0.25rem", width: "18px", height: "18px", cursor: "pointer" }}
                    />
                    <div style={{ flex: 1 }}>
                      <label htmlFor="externalDeviceDetection" style={{ display: "block", fontWeight: 600, color: "#1e293b", marginBottom: "0.25rem", cursor: "pointer" }}>
                        External Device Detection
                      </label>
                      <p style={{ fontSize: "0.875rem", color: "#64748b", margin: 0 }}>
                        Detects the presence of external devices (phones, tablets) in the camera feed that may be used for cheating.
                      </p>
                    </div>
                  </div>

                  {/* User Concentration Tracking */}
                  <div style={{ 
                    display: "flex", 
                    alignItems: "flex-start", 
                    gap: "0.75rem",
                    padding: "1rem",
                    backgroundColor: "#ffffff",
                    borderRadius: "0.5rem",
                    border: "1px solid #e2e8f0"
                  }}>
                    <input
                      type="checkbox"
                      id="concentrationTracking"
                      checked={proctoringSettings.concentrationTracking}
                      onChange={(e) => setProctoringSettings(prev => ({ ...prev, concentrationTracking: e.target.checked }))}
                      style={{ marginTop: "0.25rem", width: "18px", height: "18px", cursor: "pointer" }}
                    />
                    <div style={{ flex: 1 }}>
                      <label htmlFor="concentrationTracking" style={{ display: "block", fontWeight: 600, color: "#1e293b", marginBottom: "0.25rem", cursor: "pointer" }}>
                        User Concentration Tracking
                      </label>
                      <p style={{ fontSize: "0.875rem", color: "#64748b", margin: 0 }}>
                        Tracks gaze direction, head movement, and blinking patterns to detect if the candidate is focused on the exam or distracted.
                      </p>
                    </div>
                  </div>

                  {/* Browser Extension Usage Monitoring */}
                  <div style={{ 
                    display: "flex", 
                    alignItems: "flex-start", 
                    gap: "0.75rem",
                    padding: "1rem",
                    backgroundColor: "#ffffff",
                    borderRadius: "0.5rem",
                    border: "1px solid #e2e8f0"
                  }}>
                    <input
                      type="checkbox"
                      id="browserExtensionMonitoring"
                      checked={proctoringSettings.browserExtensionMonitoring}
                      onChange={(e) => setProctoringSettings(prev => ({ ...prev, browserExtensionMonitoring: e.target.checked }))}
                      style={{ marginTop: "0.25rem", width: "18px", height: "18px", cursor: "pointer" }}
                    />
                    <div style={{ flex: 1 }}>
                      <label htmlFor="browserExtensionMonitoring" style={{ display: "block", fontWeight: 600, color: "#1e293b", marginBottom: "0.25rem", cursor: "pointer" }}>
                        Browser Extension Usage Monitoring
                      </label>
                      <p style={{ fontSize: "0.875rem", color: "#64748b", margin: 0 }}>
                        Monitors for forbidden browser extensions that may be used to cheat, such as answer lookup tools or screen sharing extensions.
                      </p>
                    </div>
                  </div>

                  {/* Live Human Camera + Screen Monitoring */}
                  <div style={{ 
                    display: "flex", 
                    alignItems: "flex-start", 
                    gap: "0.75rem",
                    padding: "1rem",
                    backgroundColor: "#ffffff",
                    borderRadius: "0.5rem",
                    border: "1px solid #e2e8f0"
                  }}>
                    <input
                      type="checkbox"
                      id="liveCameraAndScreenMonitoring"
                      checked={proctoringSettings.liveCameraAndScreenMonitoring}
                      onChange={(e) => setProctoringSettings(prev => ({ ...prev, liveCameraAndScreenMonitoring: e.target.checked }))}
                      style={{ marginTop: "0.25rem", width: "18px", height: "18px", cursor: "pointer" }}
                    />
                    <div style={{ flex: 1 }}>
                      <label htmlFor="liveCameraAndScreenMonitoring" style={{ display: "block", fontWeight: 600, color: "#1e293b", marginBottom: "0.25rem", cursor: "pointer" }}>
                        Live Human Camera + Screen Monitoring
                      </label>
                      <p style={{ fontSize: "0.875rem", color: "#64748b", margin: 0 }}>
                        Enables real-time WebRTC streaming of candidate's camera and screen to a human proctor for live monitoring and intervention.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Candidate Requirements */}
              <div style={{ 
                marginTop: "2rem", 
                padding: "1.5rem", 
                backgroundColor: "#f8fafc", 
                borderRadius: "0.75rem", 
                border: "2px solid #e2e8f0" 
              }}>
                <h3 style={{ marginBottom: "1rem", fontSize: "1.125rem", color: "#1a1625", fontWeight: 600 }}>
                  Candidate Requirements
                </h3>

                <div>
                  <label style={{ display: "block", marginBottom: "0.75rem", fontWeight: 600, color: "#1e293b", fontSize: "0.875rem" }}>
                    Required Information
                  </label>
                  <div style={{ display: "grid", gap: "0.75rem" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={candidateRequirements.requireEmail}
                        onChange={(e) => setCandidateRequirements(prev => ({ ...prev, requireEmail: e.target.checked }))}
                        style={{ width: "18px", height: "18px", cursor: "pointer" }}
                      />
                      <span style={{ fontSize: "0.875rem", color: "#1e293b" }}>Require Email</span>
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={candidateRequirements.requireName}
                        onChange={(e) => setCandidateRequirements(prev => ({ ...prev, requireName: e.target.checked }))}
                        style={{ width: "18px", height: "18px", cursor: "pointer" }}
                      />
                      <span style={{ fontSize: "0.875rem", color: "#1e293b" }}>Require Name</span>
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={candidateRequirements.requirePhone}
                        onChange={(e) => setCandidateRequirements(prev => ({ ...prev, requirePhone: e.target.checked }))}
                        style={{ width: "18px", height: "18px", cursor: "pointer" }}
                      />
                      <span style={{ fontSize: "0.875rem", color: "#1e293b" }}>Require Phone Number</span>
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={candidateRequirements.requireResume}
                        onChange={(e) => setCandidateRequirements(prev => ({ ...prev, requireResume: e.target.checked }))}
                        style={{ width: "18px", height: "18px", cursor: "pointer" }}
                      />
                      <span style={{ fontSize: "0.875rem", color: "#1e293b" }}>Require Resume Upload</span>
                    </label>
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: "1rem", marginTop: "2rem" }}>
                <button
                  type="button"
                  onClick={() => setCurrentStation(3)}
                  className="btn-secondary"
                  style={{ flex: 1 }}
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!startTime || !endTime) {
                      setError("Please set both start and end time");
                      return;
                    }
                    if (new Date(startTime) >= new Date(endTime)) {
                      setError("End time must be after start time");
                      return;
                    }
                    
                    // Validate scheduled window >= total section time (only if per-section timers are enabled)
                    const scheduledWindow = (new Date(endTime).getTime() - new Date(startTime).getTime()) / (1000 * 60); // in minutes
                    
                    if (enablePerSectionTimers) {
                      // Use sectionTimers (from Review Questions) instead of questionTypeTimes
                      const totalTimeFromSections = Object.values(sectionTimers).reduce((sum, time) => sum + time, 0);
                      
                      if (totalTimeFromSections > scheduledWindow) {
                        setError(`Section timers (${totalTimeFromSections} minutes) exceed the scheduled exam window (${Math.round(scheduledWindow)} minutes). Please increase the scheduled window or reduce section timers.`);
                        return;
                      }
                    }
                    
                    // Save proctoring settings and schedule to draft
                    try {
                      if (assessmentId) {
                        await axios.put("/api/assessments/update-draft", {
                          assessmentId,
                          schedule: {
                            startTime,
                            endTime,
                            duration: Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / (1000 * 60)),
                            visibilityMode,
                            candidateRequirements,
                          },
                          proctoringSettings,
                        });
                      }
                    } catch (err: any) {
                      console.error("Error saving proctoring settings:", err);
                      setError(err.response?.data?.message || "Failed to save proctoring settings");
                      return;
                    }
                    
                    setError(null);
                    setCurrentStation(5);
                  }}
                  className="btn-primary"
                  style={{ flex: 1 }}
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {/* Station 5: Add Candidates */}
          {currentStation === 5 && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <div style={{ flex: 1 }}>
              <h1 style={{ marginBottom: "0.5rem", fontSize: "2rem", color: "#1a1625", fontWeight: 700 }}>
                Add Candidates
              </h1>
              <p style={{ color: "#6b6678", marginBottom: "2rem", fontSize: "1rem" }}>
                Configure exam access mode and add candidates who will take this assessment.
              </p>
                </div>
                <button
                  type="button"
                  onClick={handleBackToDashboard}
                  className="btn-secondary"
                  style={{ 
                    marginLeft: "1rem",
                    whiteSpace: "nowrap",
                    padding: "0.75rem 1.5rem",
                    fontSize: "0.875rem"
                  }}
                >
                  Back to Dashboard
                </button>
              </div>

              {/* Access Mode Selection */}
              <div style={{ marginBottom: "2rem", padding: "1.5rem", backgroundColor: "#f8fafc", borderRadius: "0.75rem", border: "2px solid #e2e8f0" }}>
                <label style={{ display: "block", marginBottom: "1rem", fontWeight: 600, color: "#1e293b", fontSize: "1.125rem" }}>
                  Exam Access Mode
                </label>
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  {(() => {
                    const currentAccessMode: "public" | "private" = accessMode;
                    const isPublic = currentAccessMode === "public";
                    return (
                      <label style={{ display: "flex", alignItems: "center", gap: "0.75rem", cursor: "pointer", padding: "1rem", backgroundColor: isPublic ? "#eff6ff" : "#ffffff", borderRadius: "0.5rem", border: `2px solid ${isPublic ? "#3b82f6" : "#e2e8f0"}` }}>
                        <input
                          type="radio"
                          name="accessMode"
                          value="public"
                          checked={isPublic}
                          onChange={(e) => {
                            setAccessMode("public");
                            if (assessmentId) {
                              axios.put("/api/assessments/update-draft", {
                                assessmentId,
                                accessMode: "public",
                              }).catch(err => console.error("Error updating access mode:", err));
                            }
                          }}
                          style={{ width: "18px", height: "18px", cursor: "pointer" }}
                        />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "0.25rem" }}>
                            Public Exam Link
                          </div>
                          <div style={{ fontSize: "0.875rem", color: "#64748b" }}>
                            Anyone with the link can access. Candidate enters name + email when starting the exam.
                          </div>
                        </div>
                      </label>
                    );
                  })()}
                  {(() => {
                    const currentAccessMode: "public" | "private" = accessMode;
                    const isPrivate = currentAccessMode === "private";
                    return (
                      <label style={{ display: "flex", alignItems: "center", gap: "0.75rem", cursor: "pointer", padding: "1rem", backgroundColor: isPrivate ? "#eff6ff" : "#ffffff", borderRadius: "0.5rem", border: `2px solid ${isPrivate ? "#3b82f6" : "#e2e8f0"}` }}>
                        <input
                          type="radio"
                          name="accessMode"
                          value="private"
                          checked={isPrivate}
                          onChange={(e) => {
                            setAccessMode("private");
                            if (assessmentId) {
                              axios.put("/api/assessments/update-draft", {
                                assessmentId,
                                accessMode: "private",
                              }).catch(err => console.error("Error updating access mode:", err));
                            }
                          }}
                          style={{ width: "18px", height: "18px", cursor: "pointer" }}
                        />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "0.25rem" }}>
                            Private Candidate Access
                          </div>
                          <div style={{ fontSize: "0.875rem", color: "#64748b" }}>
                            Only pre-added candidates may access. Exact name and email match required.
                          </div>
                        </div>
                      </label>
                    );
                  })()}
                </div>
              </div>

              {/* Private Mode: Candidate Management */}
              {(() => {
                const currentAccessMode: "public" | "private" = accessMode;
                return currentAccessMode === "private" ? (
                  <>
              <div style={{ marginBottom: "2rem" }}>
                <label style={{ display: "block", marginBottom: "0.75rem", fontWeight: 600, color: "#1e293b" }}>
                  Bulk Upload (CSV)
                </label>
                <div style={{ 
                  marginBottom: "1.5rem", 
                  padding: "1rem", 
                  backgroundColor: "#f8fafc", 
                  borderRadius: "0.5rem", 
                  border: "1px solid #e2e8f0" 
                }}>
                  <p style={{ margin: "0 0 0.75rem 0", fontSize: "0.875rem", color: "#64748b" }}>
                    Upload a CSV file with columns: <strong>name</strong> and <strong>email</strong>
                  </p>
                  {(() => {
                    const currentAccessMode: "public" | "private" = accessMode;
                    const isPublicMode = currentAccessMode === "public";
                    return (
                      <>
                  <input
                    type="file"
                    accept=".csv"
                    onChange={handleCsvUpload}
                          disabled={uploadingCsv || isPublicMode}
                    style={{ display: "none" }}
                    id="csv-upload-input"
                  />
                  <label
                    htmlFor="csv-upload-input"
                    style={{
                      display: "inline-block",
                      padding: "0.75rem 1.5rem",
                            backgroundColor: (uploadingCsv || isPublicMode) ? "#94a3b8" : "#3b82f6",
                      color: "#ffffff",
                      borderRadius: "0.5rem",
                            cursor: (uploadingCsv || isPublicMode) ? "not-allowed" : "pointer",
                      fontSize: "0.875rem",
                      fontWeight: 600,
                      transition: "background-color 0.2s",
                            opacity: isPublicMode ? 0.6 : 1,
                    }}
                  >
                    {uploadingCsv ? "Uploading..." : "Choose CSV File"}
                  </label>
                      </>
                    );
                  })()}
                  {uploadingCsv && (
                    <span style={{ marginLeft: "0.75rem", fontSize: "0.875rem", color: "#64748b" }}>
                      Processing CSV file...
                    </span>
                  )}
                  {(() => {
                    const currentAccessMode: "public" | "private" = accessMode;
                    return currentAccessMode === "public" ? (
                      <p style={{ marginTop: "0.5rem", fontSize: "0.875rem", color: "#64748b", fontStyle: "italic" }}>
                        Bulk upload is disabled in Public mode
                      </p>
                    ) : null;
                  })()}
                </div>
                </div>

                <label style={{ display: "block", marginBottom: "0.75rem", fontWeight: 600, color: "#1e293b" }}>
                  Add Candidate (Manual)
                </label>
                    {(() => {
                      const currentAccessMode: "public" | "private" = accessMode;
                      const isPublicMode = currentAccessMode === "public";
                      return (
                        <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: "0.5rem", marginBottom: "1rem" }}>
                            <div>
                  <input
                                type="text"
                                value={candidateName}
                                onChange={(e) => {
                                  setCandidateName(e.target.value);
                                  setEmailValidationError(null);
                                }}
                    onKeyPress={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddCandidate();
                      }
                    }}
                                placeholder="Full Name"
                                disabled={isPublicMode}
                    style={{
                                  width: "100%",
                      padding: "0.75rem",
                      border: "1px solid #e2e8f0",
                      borderRadius: "0.5rem",
                      fontSize: "1rem",
                                  opacity: isPublicMode ? 0.6 : 1,
                                  cursor: isPublicMode ? "not-allowed" : "text",
                    }}
                  />
                            </div>
                            <div>
                  <input
                                type="email"
                                value={candidateEmail}
                                onChange={(e) => {
                                  setCandidateEmail(e.target.value);
                                  // Real-time email validation
                                  const email = e.target.value.trim();
                                  if (email && !validateEmail(email)) {
                                    setEmailValidationError("Invalid email format");
                                  } else {
                                    setEmailValidationError(null);
                                  }
                                }}
                    onKeyPress={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddCandidate();
                      }
                    }}
                                placeholder="Email Address"
                                disabled={isPublicMode}
                    style={{
                                  width: "100%",
                      padding: "0.75rem",
                                  border: `1px solid ${emailValidationError ? "#ef4444" : "#e2e8f0"}`,
                      borderRadius: "0.5rem",
                      fontSize: "1rem",
                                  opacity: isPublicMode ? 0.6 : 1,
                                  cursor: isPublicMode ? "not-allowed" : "text",
                                }}
                              />
                              {emailValidationError && (
                                <p style={{ marginTop: "0.25rem", fontSize: "0.75rem", color: "#ef4444" }}>
                                  {emailValidationError}
                                </p>
                              )}
                            </div>
                  <button
                    type="button"
                    onClick={handleAddCandidate}
                    className="btn-secondary"
                              disabled={isPublicMode || !candidateEmail.trim() || !candidateName.trim() || !!emailValidationError}
                              style={{ 
                                marginTop: 0, 
                                whiteSpace: "nowrap", 
                                padding: "0.75rem 1.5rem",
                                opacity: (isPublicMode || !candidateEmail.trim() || !candidateName.trim() || !!emailValidationError) ? 0.6 : 1,
                                cursor: (isPublicMode || !candidateEmail.trim() || !candidateName.trim() || !!emailValidationError) ? "not-allowed" : "pointer",
                              }}
                  >
                    Add
                  </button>
                </div>
                          {isPublicMode && (
                            <p style={{ fontSize: "0.875rem", color: "#64748b", fontStyle: "italic" }}>
                              Manual candidate addition is disabled in Public mode
                            </p>
                          )}
                        </>
                      );
                    })()}
                  </>
                ) : null;
              })()}

              {/* Public Mode: Show public link info */}
              {(() => {
                const currentAccessMode: "public" | "private" = accessMode;
                return currentAccessMode === "public" ? (
                  <div style={{ marginBottom: "2rem", padding: "1.5rem", backgroundColor: "#f0fdf4", borderRadius: "0.75rem", border: "2px solid #10b981" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                      <span style={{ fontSize: "1.25rem" }}>ℹ️</span>
                      <strong style={{ color: "#059669" }}>
                        Public Exam Mode
                      </strong>
              </div>
                    <div style={{ fontSize: "0.875rem", color: "#64748b", marginLeft: "1.75rem" }}>
                      <div>Anyone with the exam link can access the assessment.</div>
                      <div style={{ marginTop: "0.5rem" }}>
                        Candidates will enter their name and email when starting the exam. Email format will be validated.
                      </div>
                    </div>
                  </div>
                ) : null;
              })()}

              {candidates.length > 0 && (
                <div style={{ marginBottom: "2rem" }}>
                  <label style={{ display: "block", marginBottom: "0.75rem", fontWeight: 600, color: "#1e293b" }}>
                    Added Candidates ({candidates.length})
                  </label>
                  <div style={{ border: "1px solid #e2e8f0", borderRadius: "0.75rem", overflow: "hidden" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ backgroundColor: "#f8fafc" }}>
                          <th style={{ padding: "1rem", textAlign: "left", borderBottom: "1px solid #e2e8f0", fontWeight: 600, color: "#1e293b" }}>
                            Email
                          </th>
                          <th style={{ padding: "1rem", textAlign: "left", borderBottom: "1px solid #e2e8f0", fontWeight: 600, color: "#1e293b" }}>
                            Name
                          </th>
                          {accessMode === "private" && (
                            <th style={{ padding: "1rem", textAlign: "left", borderBottom: "1px solid #e2e8f0", fontWeight: 600, color: "#1e293b" }}>
                              Status
                            </th>
                          )}
                          {accessMode === "private" && (
                          <th style={{ padding: "1rem", textAlign: "left", borderBottom: "1px solid #e2e8f0", fontWeight: 600, color: "#1e293b" }}>
                            Actions
                          </th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {candidates.map((candidate, index) => (
                          <tr key={index} style={{ borderBottom: "1px solid #e2e8f0" }}>
                            <td style={{ padding: "1rem" }}>{candidate.email}</td>
                            <td style={{ padding: "1rem" }}>{candidate.name}</td>
                            {accessMode === "private" && (
                            <td style={{ padding: "1rem" }}>
                                {candidate.invited ? (
                                  <span style={{ fontSize: "0.875rem", color: "#10b981", fontWeight: 600 }}>
                                    ✓ Invited
                                  </span>
                                ) : (
                                  <span style={{ fontSize: "0.875rem", color: "#64748b" }}>
                                    Pending
                                  </span>
                                )}
                              </td>
                            )}
                            {accessMode === "private" && (
                              <td style={{ padding: "1rem", display: "flex", gap: "0.5rem" }}>
                                {candidate.invited && (
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      if (!assessmentId || !assessmentUrl) return;
                                      try {
                                        const response = await axios.post("/api/assessments/send-invitations", {
                                          assessmentId,
                                          candidates: [{ email: candidate.email, name: candidate.name }],
                                          examUrl: assessmentUrl,
                                          template: invitationTemplate,
                                          forceResend: true, // Allow resending to already-invited candidates
                                        });
                                        if (response.data?.success) {
                                          // Update invite timestamp
                                          const updatedCandidates = candidates.map(c => 
                                            c.email.toLowerCase() === candidate.email.toLowerCase()
                                              ? { ...c, inviteSentAt: new Date().toISOString() }
                                              : c
                                          );
                                          setCandidates(updatedCandidates);
                                          alert("Invitation resent successfully");
                                        }
                                      } catch (err: any) {
                                        setError("Failed to resend invitation");
                                      }
                                    }}
                                    style={{
                                      background: "none",
                                      border: "1px solid #3b82f6",
                                      color: "#3b82f6",
                                      cursor: "pointer",
                                      fontSize: "0.875rem",
                                      padding: "0.25rem 0.75rem",
                                      borderRadius: "0.375rem",
                                    }}
                                  >
                                    Resend
                                  </button>
                                )}
                              <button
                                type="button"
                                onClick={() => handleRemoveCandidate(candidate.email)}
                                style={{
                                  background: "none",
                                  border: "none",
                                  color: "#ef4444",
                                  cursor: "pointer",
                                  fontSize: "0.875rem",
                                }}
                              >
                                Remove
                              </button>
                            </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Generate URL Section */}
              {!assessmentUrl && (
                <div style={{ marginBottom: "2rem" }}>
                  <button
                    type="button"
                    onClick={handleGenerateUrl}
                    className="btn-primary"
                    disabled={accessMode === "private" && candidates.length === 0}
                    style={{ width: "100%" }}
                  >
                    Generate Assessment URL
                  </button>
                  {accessMode === "private" && candidates.length === 0 && (
                    <p style={{ marginTop: "0.5rem", fontSize: "0.875rem", color: "#64748b", textAlign: "center" }}>
                      Please add at least one candidate to generate the URL
                    </p>
                  )}
                </div>
              )}

              {/* Assessment URL Display */}
              {assessmentUrl && (() => {
                const currentAccessMode: "public" | "private" = accessMode;
                const isPublic = currentAccessMode === "public";
                return (
                <div style={{ marginBottom: "2rem", padding: "1.5rem", backgroundColor: "#f8fafc", borderRadius: "0.75rem", border: "1px solid #e2e8f0" }}>
                  <label style={{ display: "block", marginBottom: "0.75rem", fontWeight: 600, color: "#1e293b" }}>
                      {isPublic ? "Public Exam Link" : "Assessment URL"}
                  </label>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <input
                      type="text"
                      value={assessmentUrl}
                      readOnly
                      style={{
                        flex: 1,
                        padding: "0.75rem",
                        border: "1px solid #e2e8f0",
                        borderRadius: "0.5rem",
                        fontSize: "1rem",
                        backgroundColor: "#ffffff",
                      }}
                    />
                    <button
                      type="button"
                      onClick={handleCopyUrl}
                      className="btn-secondary"
                      style={{ marginTop: 0, whiteSpace: "nowrap", padding: "0.75rem 1.5rem" }}
                    >
                      Copy URL
                    </button>
                  </div>
                  <p style={{ fontSize: "0.875rem", color: "#64748b", marginTop: "0.5rem" }}>
                      {isPublic 
                        ? "Share this public link. Anyone with the link can access the assessment."
                        : "Share this URL with all candidates. They will use it to access the assessment."}
                    </p>
                  </div>
                );
              })()}

              {/* Email Invitation Template (Private Mode Only) */}
              {accessMode === "private" && assessmentUrl && candidates.length > 0 && (
                <div style={{ marginBottom: "2rem", padding: "1.5rem", backgroundColor: "#f8fafc", borderRadius: "0.75rem", border: "2px solid #e2e8f0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                    <label style={{ fontWeight: 600, color: "#1e293b", fontSize: "1.125rem" }}>
                      Email Invitation Template
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowEmailTemplate(!showEmailTemplate)}
                      className="btn-secondary"
                      style={{ padding: "0.5rem 1rem", fontSize: "0.875rem" }}
                    >
                      {showEmailTemplate ? "Hide Template" : "Configure Template"}
                    </button>
                  </div>
                  
                  {showEmailTemplate && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                      <div>
                        <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b", fontSize: "0.875rem" }}>
                          Company Logo URL (optional)
                        </label>
                        <input
                          type="url"
                          value={invitationTemplate.logoUrl}
                          onChange={(e) => setInvitationTemplate({ ...invitationTemplate, logoUrl: e.target.value })}
                          placeholder="https://example.com/logo.png"
                          style={{
                            width: "100%",
                            padding: "0.75rem",
                            border: "1px solid #e2e8f0",
                            borderRadius: "0.5rem",
                            fontSize: "1rem",
                          }}
                        />
                      </div>
                      <div>
                        <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b", fontSize: "0.875rem" }}>
                          Company Name (optional)
                        </label>
                        <input
                          type="text"
                          value={invitationTemplate.companyName}
                          onChange={(e) => setInvitationTemplate({ ...invitationTemplate, companyName: e.target.value })}
                          placeholder="Your Company Name"
                          style={{
                            width: "100%",
                            padding: "0.75rem",
                            border: "1px solid #e2e8f0",
                            borderRadius: "0.5rem",
                            fontSize: "1rem",
                          }}
                        />
                      </div>
                      <div>
                        <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b", fontSize: "0.875rem" }}>
                          Custom Message
                        </label>
                        <textarea
                          value={invitationTemplate.message}
                          onChange={(e) => setInvitationTemplate({ ...invitationTemplate, message: e.target.value })}
                          placeholder="You have been invited to take an assessment..."
                          rows={4}
                          style={{
                            width: "100%",
                            padding: "0.75rem",
                            border: "1px solid #e2e8f0",
                            borderRadius: "0.5rem",
                            fontSize: "1rem",
                            fontFamily: "inherit",
                          }}
                        />
                        <p style={{ marginTop: "0.25rem", fontSize: "0.75rem", color: "#64748b" }}>
                          Available placeholders: {"{{candidate_name}}"}, {"{{candidate_email}}"}, {"{{exam_url}}"}, {"{{company_name}}"}
                        </p>
                      </div>
                      <div>
                        <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b", fontSize: "0.875rem" }}>
                          Footer Message (optional)
                        </label>
                        <input
                          type="text"
                          value={invitationTemplate.footer}
                          onChange={(e) => setInvitationTemplate({ ...invitationTemplate, footer: e.target.value })}
                          placeholder="Thank you for your participation"
                          style={{
                            width: "100%",
                            padding: "0.75rem",
                            border: "1px solid #e2e8f0",
                            borderRadius: "0.5rem",
                            fontSize: "1rem",
                          }}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          // Save template to draft
                          if (assessmentId) {
                            try {
                              await axios.put("/api/assessments/update-draft", {
                                assessmentId,
                                invitationTemplate: invitationTemplate,
                              });
                              setError(null);
                            } catch (err: any) {
                              setError("Failed to save template");
                            }
                          }
                        }}
                        className="btn-secondary"
                        style={{ alignSelf: "flex-start", padding: "0.75rem 1.5rem" }}
                      >
                        Save Template
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Send Invitations Button (Private Mode Only) */}
              {accessMode === "private" && assessmentUrl && candidates.length > 0 && (
                <div style={{ marginBottom: "2rem" }}>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!assessmentId || !assessmentUrl) {
                        setError("Assessment URL not generated");
                        return;
                      }
                      setError(null);
                      try {
                        // Only send to candidates who haven't been invited yet
                        const candidatesToInvite = candidates.filter(c => !c.invited);
                        
                        if (candidatesToInvite.length === 0) {
                          alert("All candidates have already been sent invitations.");
                          return;
                        }
                        
                        const response = await axios.post("/api/assessments/send-invitations", {
                          assessmentId,
                          candidates: candidatesToInvite.map(c => ({ email: c.email, name: c.name })),
                          examUrl: assessmentUrl,
                          template: invitationTemplate,
                        });
                        if (response.data?.success) {
                          setError(null);
                          const data = response.data.data || {};
                          const sentCount = data.sentCount || 0;
                          const skippedCount = data.skippedCount || 0;
                          
                          // Update candidates with invite status (only for newly sent)
                          const sentEmails = new Set(
                            candidatesToInvite
                              .filter((_, idx) => idx < sentCount)
                              .map(c => c.email.toLowerCase())
                          );
                          
                          const updatedCandidates = candidates.map(c => {
                            if (sentEmails.has(c.email.toLowerCase())) {
                              return {
                                ...c,
                                invited: true,
                                inviteSentAt: new Date().toISOString(),
                              };
                            }
                            return c;
                          });
                          setCandidates(updatedCandidates);
                          
                          let message = `Invitations sent successfully to ${sentCount} candidate(s)`;
                          if (skippedCount > 0) {
                            message += `. ${skippedCount} candidate(s) already invited (skipped)`;
                          }
                          alert(message);
                        }
                      } catch (err: any) {
                        setError(err.response?.data?.message || "Failed to send invitations");
                      }
                    }}
                    className="btn-primary"
                    style={{ width: "100%", padding: "1rem", fontSize: "1rem" }}
                  >
                    Send Invitations via Email
                  </button>
                </div>
              )}

              <div style={{ display: "flex", gap: "1rem", marginTop: "2rem" }}>
                <button
                  type="button"
                  onClick={() => setCurrentStation(4)}
                  className="btn-secondary"
                  style={{ flex: 1 }}
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!assessmentUrl) {
                      setError("Please generate the assessment URL first");
                      return;
                    }
                    // Only require candidates in private mode
                    if (accessMode === "private" && candidates.length === 0) {
                      setError("Please add at least one candidate for private access mode");
                      return;
                    }
                    setError(null);
                    // Save final state and redirect to dashboard
                    try {
                      if (assessmentId) {
                        await axios.post("/api/assessments/update-schedule-and-candidates", {
                          assessmentId,
                          startTime: startTime,
                          endTime: endTime,
                          candidates: accessMode === "private" ? candidates : [],
                          assessmentUrl: assessmentUrl,
                          token: assessmentUrl.split("/").pop() || "",
                          accessMode: accessMode,
                          invitationTemplate: accessMode === "private" ? invitationTemplate : undefined,
                        });
                      }
                      router.push("/dashboard");
                    } catch (err: any) {
                      setError("Failed to save. Please try again.");
                    }
                  }}
                  className="btn-primary"
                  disabled={(() => {
                    const currentAccessMode: "public" | "private" = accessMode;
                    return !assessmentUrl || (currentAccessMode === "private" && candidates.length === 0);
                  })()}
                  style={{ flex: 1 }}
                >
                  Complete
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Full-screen Preview Questions Modal */}
      {showPreviewModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.8)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "2rem",
          }}
          onClick={(e) => {
            // Close modal if clicking outside (generation continues in background)
            if (e.target === e.currentTarget) {
              setShowPreviewModal(false);
            }
          }}
        >
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "1rem",
              width: "100%",
              maxWidth: "900px",
              maxHeight: "90vh",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div
              style={{
                padding: "1.5rem",
                borderBottom: "1px solid #e2e8f0",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <h2 style={{ margin: 0, fontSize: "1.5rem", color: "#1a1625", fontWeight: 700 }}>
                Preview Questions
              </h2>
              <button
                type="button"
                onClick={() => {
                  // Close modal but keep generation running in background
                  setShowPreviewModal(false);
                  // Don't clear preview questions - they're still being generated
                }}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: "1.5rem",
                  color: "#64748b",
                  cursor: "pointer",
                  padding: "0.25rem 0.5rem",
                  lineHeight: 1,
                }}
                title={previewGenerating ? "Close (generation continues in background)" : "Close"}
              >
                ×
              </button>
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflow: "auto", padding: "1.5rem" }}>
              {previewGenerating && previewQuestions.length === 0 ? (
                // Loading state
                <div style={{ textAlign: "center", padding: "3rem" }}>
                  <div
                    style={{
                      width: "60px",
                      height: "60px",
                      border: "4px solid #e2e8f0",
                      borderTop: "4px solid #3b82f6",
                      borderRadius: "50%",
                      animation: "spin 1s linear infinite",
                      margin: "0 auto 1.5rem",
                    }}
                  />
                  <h3 style={{ margin: 0, marginBottom: "0.5rem", color: "#1a1625", fontSize: "1.25rem" }}>
                    Generating Questions...
                  </h3>
                  <p style={{ margin: 0, color: "#64748b" }}>
                    {previewProgress.current > 0
                      ? `Generated ${previewProgress.current} of ${previewProgress.total} questions`
                      : "Starting generation..."}
                  </p>
                </div>
              ) : previewQuestions.length > 0 || questions.length > 0 ? (
                // Show current question (use previewQuestions if available, otherwise questions)
                <div>
                  {(() => {
                    const questionsToShow = previewQuestions.length > 0 ? previewQuestions : questions;
                    const totalQuestions = questionsToShow.length;
                    // Ensure index is within bounds (clamp to valid range)
                    const safeIndex = totalQuestions > 0 ? Math.min(Math.max(0, currentPreviewIndex), totalQuestions - 1) : 0;
                    // Force re-retrieval of question using the safe index
                    const currentQuestion = questionsToShow[safeIndex];
                    
                    // Debug logging with question details
                    console.log(`[Preview] Rendering question: currentPreviewIndex=${currentPreviewIndex}, safeIndex=${safeIndex}, total=${totalQuestions}, hasQuestion=${!!currentQuestion}`);
                    if (currentQuestion) {
                      console.log(`[Preview] Question details: topic=${currentQuestion.topic}, type=${currentQuestion.type}, questionText=${currentQuestion.questionText?.substring(0, 50) || currentQuestion.question?.substring(0, 50) || 'N/A'}...`);
                    } else {
                      console.warn(`[Preview] No question found at index ${safeIndex} (currentPreviewIndex: ${currentPreviewIndex})`);
                    }
                    
                    return (
                      <>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginBottom: "1rem",
                            paddingBottom: "1rem",
                            borderBottom: "1px solid #e2e8f0",
                          }}
                        >
                          <div>
                            <span style={{ fontSize: "0.875rem", color: "#64748b" }}>
                              Question {safeIndex + 1} of {totalQuestions}
                            </span>
                            {previewGenerating && (
                              <span style={{ fontSize: "0.875rem", color: "#3b82f6", marginLeft: "1rem" }}>
                                Generating more...
                              </span>
                            )}
                          </div>
                          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                            <span style={{ fontSize: "0.875rem", color: "#64748b" }}>
                              {currentQuestion?.topic || "Unknown Topic"} -{" "}
                              {currentQuestion?.type || "Unknown Type"}
                            </span>
                            {currentQuestion?.difficulty && (
                        <span
                          style={{
                            fontSize: "0.75rem",
                            padding: "0.25rem 0.5rem",
                            backgroundColor: "#f1f5f9",
                            borderRadius: "0.25rem",
                            color: "#64748b",
                          }}
                        >
                          {currentQuestion.difficulty}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => handleEditQuestion(safeIndex)}
                        disabled={editingQuestionIndex !== null}
                        style={{
                          padding: "0.375rem 0.75rem",
                          background: "#3b82f6",
                          border: "none",
                          color: "#ffffff",
                          cursor: editingQuestionIndex !== null ? "not-allowed" : "pointer",
                          fontSize: "0.75rem",
                          fontWeight: 500,
                          borderRadius: "0.375rem",
                          opacity: editingQuestionIndex !== null ? 0.6 : 1,
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRegenerateQuestion(safeIndex)}
                        disabled={regeneratingQuestionIndex === safeIndex || previewGenerating}
                        style={{
                          padding: "0.375rem 0.75rem",
                          background: "#10b981",
                          border: "none",
                          color: "#ffffff",
                          cursor: (regeneratingQuestionIndex === safeIndex || previewGenerating) ? "not-allowed" : "pointer",
                          fontSize: "0.75rem",
                          fontWeight: 500,
                          borderRadius: "0.375rem",
                          opacity: (regeneratingQuestionIndex === safeIndex || previewGenerating) ? 0.6 : 1,
                        }}
                      >
                        {regeneratingQuestionIndex === safeIndex ? "Regenerating..." : "Regenerate"}
                      </button>
                    </div>
                  </div>

                  <div
                    key={`question-${safeIndex}-${currentQuestion?.questionText?.substring(0, 50) || currentQuestion?.question?.substring(0, 50) || safeIndex}-${currentQuestion?.topic || 'unknown'}`}
                    style={{
                      backgroundColor: "#ffffff",
                      padding: "1.5rem",
                      borderRadius: "0.5rem",
                      border: "1px solid #e2e8f0",
                      minHeight: "300px",
                    }}
                  >
                    {/* Render question based on type using formatted components */}
                    {(() => {
                      const questionType = currentQuestion?.type || "Subjective";
                      const questionForRender = {
                        question: currentQuestion?.questionText || currentQuestion?.question || "",
                        options: currentQuestion?.options || [],
                        correctAnswer: currentQuestion?.correctAnswer || "",
                        idealAnswer: currentQuestion?.idealAnswer || "",
                        expectedLogic: currentQuestion?.expectedLogic || "",
                        title: currentQuestion?.title || "",
                        problemStatement: currentQuestion?.problemStatement || currentQuestion?.questionText || currentQuestion?.question || "",
                        functionSignature: currentQuestion?.functionSignature || "",
                        inputFormat: currentQuestion?.inputFormat || "",
                        outputFormat: currentQuestion?.outputFormat || "",
                        constraints: currentQuestion?.constraints || "",
                        sampleInput: currentQuestion?.sampleInput || "",
                        sampleOutput: currentQuestion?.sampleOutput || "",
                        visibleTestCases: currentQuestion?.public_testcases || currentQuestion?.visibleTestCases || [],
                      };
                      
                      // Map old type names to new ones
                      const mappedType = questionType === "coding" ? "Coding" : 
                                        questionType === "MCQ" ? "MCQ" :
                                        questionType === "Pseudo Code" || questionType === "PseudoCode" ? "PseudoCode" :
                                        "Subjective";
                      
                      return renderQuestionByType(questionForRender, mappedType, false);
                    })()}
                  </div>
                      </>
                    );
                  })()}
                </div>
              ) : (
                // No questions yet
                <div style={{ textAlign: "center", padding: "3rem", color: "#64748b" }}>
                  <p>No questions generated yet.</p>
                </div>
              )}

            </div>

            {/* Footer with Navigation */}
            {(previewQuestions.length > 0 || questions.length > 0) && (
              <div
                style={{
                  padding: "1.5rem",
                  borderTop: "1px solid #e2e8f0",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                {(() => {
                  const questionsToShow = previewQuestions.length > 0 ? previewQuestions : questions;
                  const totalQuestions = questionsToShow.length;
                  // Calculate safe index for navigation buttons
                  const navSafeIndex = totalQuestions > 0 ? Math.min(Math.max(0, currentPreviewIndex), totalQuestions - 1) : 0;
                  
                  return (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setCurrentPreviewIndex((prevIndex) => {
                            const newIndex = Math.max(0, prevIndex - 1);
                            console.log(`[Preview] Previous clicked: ${prevIndex} -> ${newIndex} (total: ${totalQuestions})`);
                            return newIndex;
                          });
                        }}
                        disabled={navSafeIndex === 0}
                        className="btn-secondary"
                        style={{
                          marginTop: 0,
                          opacity: navSafeIndex === 0 ? 0.5 : 1,
                          cursor: navSafeIndex === 0 ? "not-allowed" : "pointer",
                        }}
                      >
                        Previous
                      </button>

                      <div style={{ fontSize: "0.875rem", color: "#64748b" }}>
                        {navSafeIndex + 1} / {totalQuestions}
                        {previewGenerating && " (generating...)"}
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setCurrentPreviewIndex((prevIndex) => {
                            const newIndex = Math.min(totalQuestions - 1, prevIndex + 1);
                            console.log(`[Preview] Next clicked: ${prevIndex} -> ${newIndex} (total: ${totalQuestions})`);
                            return newIndex;
                          });
                        }}
                        disabled={
                          navSafeIndex >= totalQuestions - 1 && 
                          (previewGenerating || (previewProgress.total > 0 && previewProgress.current < previewProgress.total))
                        }
                        className="btn-primary"
                        style={{
                          marginTop: 0,
                          opacity:
                            navSafeIndex >= totalQuestions - 1 && 
                            (previewGenerating || (previewProgress.total > 0 && previewProgress.current < previewProgress.total))
                              ? 0.5 : 1,
                          cursor:
                            navSafeIndex >= totalQuestions - 1 && 
                            (previewGenerating || (previewProgress.total > 0 && previewProgress.current < previewProgress.total))
                              ? "not-allowed"
                              : "pointer",
                        }}
                      >
                        {navSafeIndex >= totalQuestions - 1 && (previewGenerating || (previewProgress.total > 0 && previewProgress.current < previewProgress.total))
                          ? "Generating..."
                          : "Next"}
                      </button>
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Edit Question Modal */}
      {editingQuestionIndex !== null && editingQuestion && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10000,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setEditingQuestionIndex(null);
              setEditingQuestion(null);
            }
          }}
        >
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "0.75rem",
              padding: "2rem",
              maxWidth: "800px",
              width: "90%",
              maxHeight: "90vh",
              overflowY: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginBottom: "1.5rem", fontSize: "1.5rem", color: "#1a1625", fontWeight: 700 }}>
              Edit Question
            </h2>

            <div style={{ marginBottom: "1rem" }}>
              <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
                Question Text
              </label>
              <textarea
                value={editingQuestion.questionText || editingQuestion.question || ""}
                onChange={(e) =>
                  setEditingQuestion({ ...editingQuestion, questionText: e.target.value, question: e.target.value })
                }
                style={{
                  width: "100%",
                  minHeight: "150px",
                  padding: "0.75rem",
                  border: "1px solid #e2e8f0",
                  borderRadius: "0.5rem",
                  fontSize: "0.875rem",
                  fontFamily: "inherit",
                }}
              />
            </div>

            {editingQuestion.type === "MCQ" && (
              <>
                <div style={{ marginBottom: "1rem" }}>
                  <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
                    Options (one per line)
                  </label>
                  <textarea
                    value={(editingQuestion.options || []).join("\n")}
                    onChange={(e) =>
                      setEditingQuestion({
                        ...editingQuestion,
                        options: e.target.value.split("\n").filter((opt: string) => opt.trim()),
                      })
                    }
                    style={{
                      width: "100%",
                      minHeight: "100px",
                      padding: "0.75rem",
                      border: "1px solid #e2e8f0",
                      borderRadius: "0.5rem",
                      fontSize: "0.875rem",
                      fontFamily: "inherit",
                    }}
                  />
                </div>
                <div style={{ marginBottom: "1rem" }}>
                  <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
                    Correct Answer
                  </label>
                  <input
                    type="text"
                    value={editingQuestion.correctAnswer || ""}
                    onChange={(e) => setEditingQuestion({ ...editingQuestion, correctAnswer: e.target.value })}
                    style={{
                      width: "100%",
                      padding: "0.75rem",
                      border: "1px solid #e2e8f0",
                      borderRadius: "0.5rem",
                      fontSize: "0.875rem",
                    }}
                  />
                </div>
              </>
            )}

            {editingQuestion.type === "coding" && (
              <>
                {editingQuestion.title && (
                  <div style={{ marginBottom: "1rem" }}>
                    <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
                      Title
                    </label>
                    <input
                      type="text"
                      value={editingQuestion.title || ""}
                      onChange={(e) => setEditingQuestion({ ...editingQuestion, title: e.target.value })}
                      style={{
                        width: "100%",
                        padding: "0.75rem",
                        border: "1px solid #e2e8f0",
                        borderRadius: "0.5rem",
                        fontSize: "0.875rem",
                      }}
                    />
                  </div>
                )}
                {editingQuestion.functionSignature && (
                  <div style={{ marginBottom: "1rem" }}>
                    <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
                      Function Signature
                    </label>
                    <textarea
                      value={editingQuestion.functionSignature || ""}
                      onChange={(e) => setEditingQuestion({ ...editingQuestion, functionSignature: e.target.value })}
                      style={{
                        width: "100%",
                        minHeight: "60px",
                        padding: "0.75rem",
                        border: "1px solid #e2e8f0",
                        borderRadius: "0.5rem",
                        fontSize: "0.875rem",
                        fontFamily: "monospace",
                      }}
                    />
                  </div>
                )}
                {editingQuestion.public_testcases && Array.isArray(editingQuestion.public_testcases) && editingQuestion.public_testcases.length > 0 && (
                  <div style={{ marginBottom: "1rem" }}>
                    <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
                      Test Cases ({editingQuestion.public_testcases.length} case(s))
                    </label>
                    <div style={{
                      padding: "1rem",
                      backgroundColor: "#f8fafc",
                      borderRadius: "0.5rem",
                      border: "1px solid #e2e8f0",
                      maxHeight: "300px",
                      overflowY: "auto",
                    }}>
                      {editingQuestion.public_testcases.map((testCase: any, idx: number) => (
                        <div key={idx} style={{
                          marginBottom: idx < editingQuestion.public_testcases.length - 1 ? "1rem" : 0,
                          padding: "0.75rem",
                          backgroundColor: "#ffffff",
                          borderRadius: "0.375rem",
                          border: "1px solid #e2e8f0",
                        }}>
                          <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#64748b", marginBottom: "0.5rem" }}>
                            Test Case {idx + 1}
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                            <div>
                              <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#64748b", marginBottom: "0.25rem" }}>
                                Input:
                              </div>
                              <textarea
                                value={typeof testCase.input === 'string' ? testCase.input : JSON.stringify(testCase.input)}
                                onChange={(e) => {
                                  const newTestCases = [...editingQuestion.public_testcases];
                                  try {
                                    newTestCases[idx] = { ...testCase, input: JSON.parse(e.target.value) };
                                  } catch {
                                    newTestCases[idx] = { ...testCase, input: e.target.value };
                                  }
                                  setEditingQuestion({ ...editingQuestion, public_testcases: newTestCases });
                                }}
                                style={{
                                  width: "100%",
                                  minHeight: "60px",
                                  padding: "0.5rem",
                                  border: "1px solid #e2e8f0",
                                  borderRadius: "0.25rem",
                                  fontSize: "0.75rem",
                                  fontFamily: "monospace",
                                }}
                              />
                            </div>
                            <div>
                              <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#64748b", marginBottom: "0.25rem" }}>
                                Output:
                              </div>
                              <textarea
                                value={typeof testCase.output === 'string' ? testCase.output : JSON.stringify(testCase.output)}
                                onChange={(e) => {
                                  const newTestCases = [...editingQuestion.public_testcases];
                                  try {
                                    newTestCases[idx] = { ...testCase, output: JSON.parse(e.target.value) };
                                  } catch {
                                    newTestCases[idx] = { ...testCase, output: e.target.value };
                                  }
                                  setEditingQuestion({ ...editingQuestion, public_testcases: newTestCases });
                                }}
                                style={{
                                  width: "100%",
                                  minHeight: "60px",
                                  padding: "0.5rem",
                                  border: "1px solid #e2e8f0",
                                  borderRadius: "0.25rem",
                                  fontSize: "0.75rem",
                                  fontFamily: "monospace",
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            <div style={{ display: "flex", gap: "1rem", justifyContent: "flex-end", marginTop: "1.5rem" }}>
              <button
                type="button"
                onClick={() => {
                  setEditingQuestionIndex(null);
                  setEditingQuestion(null);
                }}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button type="button" onClick={handleSaveEditedQuestion} className="btn-primary">
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add CSS for spinner animation */}
      <style jsx>{`
        @keyframes spin {
          0% {
            transform: rotate(0deg);
          }
          100% {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}

// Server-side authentication check
export const getServerSideProps: GetServerSideProps = requireAuth;


