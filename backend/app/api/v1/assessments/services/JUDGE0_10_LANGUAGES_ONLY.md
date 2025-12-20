# 🎯 Judge0 Platform - ONLY 10 Languages Supported

## ⚠️ **CRITICAL CONSTRAINT**

**The platform ONLY supports these 10 programming languages for Coding questions via Judge0:**

1. **Python**
2. **JavaScript**
3. **C++**
4. **Java**
5. **C**
6. **Go**
7. **Rust**
8. **C#** (C Sharp)
9. **Kotlin**
10. **TypeScript**

**Any other language or framework → MCQ/Subjective questions (NOT Coding)**

---

## ✅ **What Was Updated**

### **1. Limited to Exact 10 Languages** (`prompt_templates.py`)

**Before:**
```python
CODING_LANGUAGES = [
    "python", "java", "javascript", "c++", "c",
    "go", "ruby", "typescript", "rust", "kotlin",
    "swift", "php", "perl", "scala", "r", "bash"  # ❌ TOO MANY
]
```

**After:**
```python
# CRITICAL: ONLY these 10 languages are supported by Judge0
CODING_LANGUAGES = [
    "python",           # 1
    "javascript",       # 2
    "cpp",             # 3 (C++)
    "java",            # 4
    "c",               # 5
    "go",              # 6
    "rust",            # 7
    "csharp",          # 8 (C#)
    "kotlin",          # 9
    "typescript",      # 10
]
```

**Removed:** Ruby, Swift, PHP, Perl, Scala, R, Bash (NOT Judge0-supported)

---

### **2. Judge0-Compatible Question Requirements** (`ai_coding_generator.py`)

Updated prompt to enforce Judge0 platform requirements:

```python
⚠️ JUDGE0 COMPATIBILITY RULES (MANDATORY):
1. Questions MUST be executable via stdin/stdout
2. NO external libraries/frameworks (Django, Flask, React, TensorFlow, Pandas, etc.)
3. ONLY standard library features allowed
4. Algorithm/data structure problems (LeetCode-style)
5. Pure computational problems with clear input/output

VALID Judge0 Topics:
✅ Algorithms: sorting, searching, recursion, dynamic programming
✅ Data structures: arrays, lists, stacks, queues, trees, graphs
✅ String manipulation, math problems, bit manipulation
✅ Standard library usage (built-in functions, collections)

INVALID Topics (NOT Judge0-compatible):
❌ Web frameworks (Django, Flask, Express, Spring)
❌ Frontend frameworks (React, Angular, Vue)
❌ ML/Data libraries (TensorFlow, PyTorch, Pandas, NumPy)
❌ Database queries, API calls, file I/O operations
❌ GUI applications, network programming
```

**Purpose**: Ensures generated questions are executable on Judge0 platform.

---

### **3. Enhanced Topic Generation** (`ai_topic_generator.py`)

Updated prompt with clear examples:

```python
Examples of VALID Coding topics:
✅ "Python Sorting Algorithms" - Algorithm implementation
✅ "Java Data Structures (Arrays, Lists)" - Core language features
✅ "JavaScript Recursion and Dynamic Programming" - Problem solving
✅ "C++ STL Algorithms" - Standard library (Judge0 compatible)
✅ "Go Concurrency with Goroutines" - Core language feature

Examples of INVALID Coding topics (use MCQ/Subjective instead):
❌ "Django REST Framework" - Web framework, not Judge0 compatible
❌ "React Hooks and State Management" - Frontend framework
❌ "TensorFlow Model Training" - ML library, use AIML type
❌ "Pandas Data Analysis" - Data library, use AIML type
❌ "Spring Boot Microservices" - Framework
```

---

### **4. Expanded Test Coverage** (`test_coding_topic_generation.py`)

Added tests for all 10 languages:

**Test Cases:**
1. ✅ Python → Coding
2. ✅ Python + Java + JavaScript → Coding
3. ✅ Django (framework) → MCQ/Subjective
4. ✅ C++ + Go + Rust → Coding
5. ✅ C# + Kotlin + TypeScript → Coding
6. ✅ Ruby (non-Judge0) → MCQ/Subjective

---

## 📊 **Judge0 Language Support Matrix**

| Language | Judge0 ID | Supported | Question Type | Example |
|----------|-----------|-----------|---------------|---------|
| Python | 71 | ✅ Yes | Coding | "Python Binary Search" |
| JavaScript | 63 | ✅ Yes | Coding | "JS Two Sum Problem" |
| C++ | 54 | ✅ Yes | Coding | "C++ Sorting Algorithm" |
| Java | 62 | ✅ Yes | Coding | "Java LinkedList Implementation" |
| C | 50 | ✅ Yes | Coding | "C Array Manipulation" |
| Go | 60 | ✅ Yes | Coding | "Go Goroutine Challenge" |
| Rust | 73 | ✅ Yes | Coding | "Rust Ownership Problem" |
| C# | 51 | ✅ Yes | Coding | "C# LINQ Query" |
| Kotlin | 78 | ✅ Yes | Coding | "Kotlin Collection Operations" |
| TypeScript | 74 | ✅ Yes | Coding | "TypeScript Generic Function" |
| **Ruby** | - | ❌ No | MCQ/Subjective | "Ruby Basics" (MCQ) |
| **Swift** | - | ❌ No | MCQ/Subjective | "Swift Concepts" (MCQ) |
| **PHP** | - | ❌ No | MCQ/Subjective | "PHP Syntax" (MCQ) |
| **Perl** | - | ❌ No | MCQ/Subjective | "Perl Regex" (MCQ) |
| **Scala** | - | ❌ No | MCQ/Subjective | "Scala Features" (MCQ) |
| **R** | - | ❌ No | MCQ/Subjective | "R Statistics" (MCQ) |
| **Bash** | - | ❌ No | MCQ/Subjective | "Shell Scripting" (MCQ) |

---

## 🔍 **Question Compatibility Rules**

### **✅ Judge0-Compatible Questions:**

**Characteristics:**
- Pure algorithm/data structure problems
- Uses only standard library
- stdin/stdout based input/output
- No external dependencies
- Computational/mathematical problems

**Examples:**
```
✅ "Implement a function to find the longest palindrome in a string"
✅ "Given an array, find two numbers that sum to target"
✅ "Reverse a linked list iteratively and recursively"
✅ "Implement binary search tree operations"
✅ "Find the Nth Fibonacci number using dynamic programming"
```

### **❌ NOT Judge0-Compatible:**

**Characteristics:**
- Requires external frameworks/libraries
- Web/API/database operations
- File I/O, network I/O
- GUI applications
- ML/Data science libraries

**Examples:**
```
❌ "Build a REST API using Django"
❌ "Create a React component with state"
❌ "Train a neural network using TensorFlow"
❌ "Analyze data with Pandas DataFrame"
❌ "Query database using SQL ORM"
```

---

## 🎯 **User Experience**

### **Scenario 1: Python Skill**
```
User adds: "Python"
✅ Topics Generated:
- "Python List Comprehensions" (Coding)
- "Python Recursion and Memoization" (Coding)
- "Python Binary Search Implementation" (Coding)

Result: Coding questions with Judge0 execution ✅
```

### **Scenario 2: Django Skill**
```
User adds: "Django"
✅ Topics Generated:
- "Django Model Design" (MCQ)
- "Django Views and Templates" (Subjective)
- "Django REST Framework Concepts" (MCQ)

Result: Theory questions, NO Coding (framework not executable) ✅
```

### **Scenario 3: Ruby Skill**
```
User adds: "Ruby"
✅ Topics Generated:
- "Ruby Language Features" (MCQ)
- "Ruby Object-Oriented Programming" (Subjective)
- "Ruby Blocks and Procs" (MCQ)

Result: Theory questions, NO Coding (Ruby not in Judge0 list) ✅
```

### **Scenario 4: C++ Skill**
```
User adds: "C++"
✅ Topics Generated:
- "C++ STL Vector Operations" (Coding)
- "C++ Memory Management" (Coding)
- "C++ Template Programming" (Coding)

Result: Coding questions with Judge0 execution ✅
```

---

## 🚀 **Benefits of 10-Language Restriction**

### **For Platform:**
✅ Consistent Judge0 integration  
✅ Reliable code execution  
✅ No unsupported language errors  
✅ Clear boundaries for Coding vs MCQ

### **For Users:**
✅ Clear expectations (10 languages only)  
✅ Proper question types assigned  
✅ Frameworks correctly handled (MCQ/Subjective)  
✅ No confusion about what's executable

### **For Candidates:**
✅ Questions actually run on Judge0  
✅ Proper testcase validation  
✅ No execution failures  
✅ Professional coding interview experience

---

## 📋 **Implementation Checklist**

- [x] Limited `CODING_LANGUAGES` to exactly 10 languages
- [x] Removed: Ruby, Swift, PHP, Perl, Scala, R, Bash
- [x] Updated topic generation prompt with Judge0 rules
- [x] Updated coding question generator with Judge0 compatibility
- [x] Added validation for Judge0-compatible topics
- [x] Created test cases for all 10 languages
- [x] Added test for non-Judge0 language (Ruby)
- [x] Updated documentation
- [x] No linter errors

---

## 🎉 **Summary**

**Restricted coding questions to ONLY 10 Judge0-supported languages:**

### **✅ SUPPORTED (Coding Questions):**
1. Python
2. JavaScript
3. C++
4. Java
5. C
6. Go
7. Rust
8. C# (C Sharp)
9. Kotlin
10. TypeScript

### **❌ NOT SUPPORTED (MCQ/Subjective Only):**
- Ruby, Swift, PHP, Perl, Scala, R, Bash, etc.
- All frameworks (Django, React, Spring, etc.)
- All ML libraries (TensorFlow, PyTorch, Pandas, etc.)

**Questions are guaranteed to be:**
- ✅ Judge0-compatible (stdin/stdout)
- ✅ Executable without external dependencies
- ✅ Algorithmic/data structure focused
- ✅ Standard library only

**The platform now only generates Coding questions for languages that Judge0 can actually execute!** 🚀

---

**Files Modified:**
1. `prompt_templates.py` - Limited to 10 languages
2. `ai_topic_generator.py` - Judge0 compatibility rules
3. `ai_coding_generator.py` - Judge0 platform requirements
4. `test_coding_topic_generation.py` - Expanded test coverage
5. `CODING_LANGUAGES_FIX.md` - Updated documentation

**Status**: ✅ Complete  
**Date**: December 20, 2025

