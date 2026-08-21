import { Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute } from './ProtectedRoute';

import { 
  Dashboard, 
  GenerateCourse, 
  Courses, 
  CourseOverview, 
  Learn, 
  Profile, 
  NotFound 
} from '../pages';


export const AppRoutes = () => {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />

      <Route element={<ProtectedRoute />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/generate" element={<GenerateCourse />} />
        <Route path="/courses" element={<Courses />} />
        <Route path="/courses/:courseId" element={<CourseOverview />} />
        <Route path="/courses/:courseId/learn/:lessonId" element={<Learn />} />
        <Route path="/profile" element={<Profile />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};