import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import { Suspense, lazy } from 'react';

// Layouts
import Layout from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import { LoadingSpinner } from './components/LoadingSpinner';

// Page Imports - 使用懒加载优化性能
const IndexPage = lazy(() => import('./pages/IndexPage'));
const NodePage = lazy(() => import('./pages/NodePage'));
const ThreadPage = lazy(() => import('./pages/ThreadPage'));
const NewThreadPage = lazy(() => import('./pages/NewThreadPage'));
const EditPostPage = lazy(() => import('./pages/EditPostPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));
const UserThreadsPage = lazy(() => import('./pages/UserThreadsPage'));
const SearchPage = lazy(() => import('./pages/SearchPage'));
const RankingsPage = lazy(() => import('./pages/RankingsPage'));

// Admin Page Imports
const AdminLoginPage = lazy(() => import('./pages/admin/LoginPage'));
const AdminDashboardPage = lazy(() => import('./pages/admin/DashboardPage'));
const AdminUsersPage = lazy(() => import('./pages/admin/UsersPage'));
const AdminUsersGroupPage = lazy(() => import('./pages/admin/UserGroupsPage'));
const EditAdminUserGroupPage = lazy(() => import('./pages/admin/EditUserGroupPage'));
const AdminContentPage = lazy(() => import('./pages/admin/ContentPage'));
const AdminRepliesPage = lazy(() => import('./pages/admin/RepliesPage'));
const AdminNodesPage = lazy(() => import('./pages/admin/NodesPage'));
const AdminSiteSettingsPage = lazy(() => import('./pages/admin/SiteSettingsPage'));

import { useAuth } from './hooks/useAuth';

// 页面加载 fallback
const PageLoader = () => (
  <div className="min-h-[400px] flex items-center justify-center">
    <LoadingSpinner size="lg" text="页面加载中..." />
  </div>
);

// Private Route for standard users
const PrivateRoute = ({ children }: { children: JSX.Element }) => {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <PageLoader />;
  return isAuthenticated ? children : <Navigate to="/auth" />;
};

// Private Route for admin area
const AdminPrivateRoute = ({ children }: { children: JSX.Element }) => {
  const token = localStorage.getItem('token');
  return token ? children : <Navigate to="/admin/login" />;
};

// Component to handle all user-facing routes with the main Layout
const MainApp = () => {
  return (
    <Layout>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<IndexPage />} />
          <Route path="/nodes/:nodeId" element={<NodePage />} />
          <Route path="/threads/:threadId" element={<ThreadPage />} />
          <Route path="/threads/:threadId/update" element={<PrivateRoute><EditPostPage /></PrivateRoute>} />
          <Route path="/threads/:threadId/replies/:replyId/update" element={<PrivateRoute><EditPostPage /></PrivateRoute>} />
          <Route path="/nodes/:nodeId/new" element={<PrivateRoute><NewThreadPage /></PrivateRoute>} />
          <Route path="/users/:username" element={<ProfilePage />} />
          <Route path="/users/:username/threads" element={<UserThreadsPage />} />
          <Route path="/settings" element={<PrivateRoute><SettingsPage /></PrivateRoute>} />
          <Route path="/notifications" element={<PrivateRoute><NotificationsPage /></PrivateRoute>} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/rankings" element={<RankingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Layout>
  );
};

function App() {
  return (
    <ErrorBoundary>
      <Router>
        <Routes>
          {/* Admin routes (no main layout) */}
          <Route path="/admin/login" element={
            <Suspense fallback={<PageLoader />}>
              <AdminLoginPage />
            </Suspense>
          } />
          <Route path="/admin/dashboard" element={
            <AdminPrivateRoute>
              <Suspense fallback={<PageLoader />}>
                <AdminDashboardPage />
              </Suspense>
            </AdminPrivateRoute>
          } />
          <Route path="/admin/users" element={
            <AdminPrivateRoute>
              <Suspense fallback={<PageLoader />}>
                <AdminUsersPage />
              </Suspense>
            </AdminPrivateRoute>
          } />
          <Route path="/admin/users/groups" element={
            <AdminPrivateRoute>
              <Suspense fallback={<PageLoader />}>
                <AdminUsersGroupPage />
              </Suspense>
            </AdminPrivateRoute>
          } />
          <Route path="/admin/users/groups/:levelId" element={
            <AdminPrivateRoute>
              <Suspense fallback={<PageLoader />}>
                <EditAdminUserGroupPage />
              </Suspense>
            </AdminPrivateRoute>
          } />
          <Route path="/admin/content/threads" element={
            <AdminPrivateRoute>
              <Suspense fallback={<PageLoader />}>
                <AdminContentPage />
              </Suspense>
            </AdminPrivateRoute>
          } />
          <Route path="/admin/content/replies" element={
            <AdminPrivateRoute>
              <Suspense fallback={<PageLoader />}>
                <AdminRepliesPage />
              </Suspense>
            </AdminPrivateRoute>
          } />
          <Route path="/admin/setting" element={
            <AdminPrivateRoute>
              <Suspense fallback={<PageLoader />}>
                <AdminSiteSettingsPage />
              </Suspense>
            </AdminPrivateRoute>
          } />
          <Route path="/admin/setting/nodes" element={
            <AdminPrivateRoute>
              <Suspense fallback={<PageLoader />}>
                <AdminNodesPage />
              </Suspense>
            </AdminPrivateRoute>
          } />
          <Route path="/admin/*" element={<Navigate to="/admin/login" replace />} />

          {/* All user-facing routes are handled by MainApp */}
          <Route path="/*" element={<MainApp />} />
        </Routes>
      </Router>
    </ErrorBoundary>
  );
}

export default App;
