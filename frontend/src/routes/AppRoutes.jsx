import { Routes, Route } from 'react-router-dom';
import { ProtectedRoute } from './ProtectedRoute';
import { Root } from './Root';
import { AppLayout } from '../components/layout/AppLayout';

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
      <Route path="/" element={<Root />} />

      <Route element={<ProtectedRoute />}>

        <Route element={<AppLayout />}>

          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/generate" element={<GenerateCourse />} />
          <Route path="/courses" element={<Courses />} />
          <Route path="/courses/:courseId" element={<CourseOverview />} />
          {/* moduleId is part of the path because the lesson API is addressed
              through its module — lessonId alone cannot be fetched. */}
          <Route
            path="/courses/:courseId/modules/:moduleId/lessons/:lessonId"
            element={<Learn />}
          />
          <Route path="/profile" element={<Profile />} />

        </Route>
        
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};