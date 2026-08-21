import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Textarea, SegmentedControl, Button, ErrorState } from '../../components/common';
import { generateCourse } from '../../api/course.api';

const DIFFICULTY_OPTIONS = [
  { label: 'Beginner', value: 'beginner' },
  { label: 'Intermediate', value: 'intermediate' },
  { label: 'Advanced', value: 'advanced' }
];

const GenerateCourse = () => {
  const navigate = useNavigate();
  
  // Form state
  const [topic, setTopic] = useState('');
  const [difficulty, setDifficulty] = useState('beginner');
  const [error, setError] = useState(null); // Validation error
  
  // Submission state
  const [status, setStatus] = useState('idle'); // 'idle' | 'submitting' | 'error'
  const [submitError, setSubmitError] = useState(null);

  const validate = (text) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return "Please tell us what you want to learn";
    }
    if (trimmed.length < 3) {
      return "Topic must be at least 3 characters";
    }
    if (trimmed.length > 300) {
      return "Topic must not exceed 300 characters";
    }
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    const validationError = validate(topic);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setStatus('submitting');
    setSubmitError(null);

    try {

      const response = await generateCourse({ 
        topic: topic.trim(), 
        difficulty 
      });
      
      // On success, redirect to the course overview page.
      navigate(`/courses/${response.courseId}`);
    } catch (err) {
      setStatus('error');
      setSubmitError(err.message);
    }
  };

  // If the API call fails, swap out the form for the ErrorState primitive.
  // We don't lose topic/difficulty state, so clicking "Try Again" is seamless.
  if (status === 'error') {
    return (
      <div className="max-w-2xl mx-auto mt-8">
        <ErrorState 
          title="We couldn't create the course"
          message={submitError}
          onRetry={() => setStatus('idle')}
        />
      </div>
    );
  }

  const isSubmitting = status === 'submitting';

  return (
    <div className="max-w-2xl mx-auto mt-8">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 sm:p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Create a new course
        </h1>
        
        {isSubmitting ? (
          <p className="text-sm text-blue-600 mb-6 font-medium animate-pulse">
            Creating your course… this may take a moment.
          </p>
        ) : (
          <p className="text-sm text-gray-500 mb-6">
            What topic would you like to explore today?
          </p>
        )}
        
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="relative">
            <div className="flex justify-between items-end mb-1">
              <label htmlFor="topic" className="text-sm font-medium text-gray-700">
                Topic
              </label>
              <span className={`text-xs ${topic.length > 300 ? 'text-red-500' : 'text-gray-400'}`}>
                {topic.length} / 300
              </span>
            </div>
            
            <Textarea
              id="topic"
              rows={4}
              placeholder="e.g., The history of Roman Aqueducts, Python for Data Science..."
              value={topic}
              disabled={isSubmitting}
              onChange={(e) => {
                setTopic(e.target.value);
                if (error) setError(null);
              }}
              error={error}
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-gray-700">
              Difficulty Level
            </label>
            <SegmentedControl
              options={DIFFICULTY_OPTIONS}
              value={difficulty}
              onChange={setDifficulty}
              className={isSubmitting ? 'opacity-50 pointer-events-none' : ''}
            />
          </div>

          <div className="pt-4 border-t border-gray-100 flex justify-end">
            <Button 
              type="submit" 
              variant="primary" 
              loading={isSubmitting}
            >
              Generate Course
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default GenerateCourse;