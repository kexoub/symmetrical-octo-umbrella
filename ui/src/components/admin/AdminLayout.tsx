import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import Home from 'lucide-react/dist/esm/icons/home';
import LogOut from 'lucide-react/dist/esm/icons/log-out';

const AdminLayout = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem('token');
    navigate('/admin/login');
  };

  const mainNavItems = [
    { href: '/admin/dashboard', label: '首页', icon: 'home' },
    { href: '/admin/setting', label: '论坛设置', icon: 'settings' },
    { href: '/admin/users', label: '用户管理', icon: 'users' },
    { href: '/admin/content/threads', label: '内容管理', icon: 'content' },
  ];

  // 根据当前路径判断侧边栏显示内容
  const renderSidebarNav = () => {
    if (location.pathname.startsWith('/admin/setting')) {
      return (
        <div className="space-y-1">
          <SidebarItem href="/admin/setting" label="站点信息" active={location.pathname === '/admin/setting'} />
          <SidebarItem href="/admin/setting/nodes" label="版块管理" active={location.pathname === '/admin/setting/nodes'} />
          <SidebarItem href="/admin/setting/registration" label="注册设置" active={location.pathname === '/admin/setting/registration'} />
        </div>
      );
    }
    if (location.pathname.startsWith('/admin/users')) {
      return (
        <div className="space-y-1">
          <SidebarItem href="/admin/users" label="用户管理" active={location.pathname === '/admin/users'} />
          <SidebarItem href="/admin/users/groups" label="用户组" active={location.pathname === '/admin/users/groups'} />
        </div>
      );
    }
    if (location.pathname.startsWith('/admin/content')) {
      return (
        <div className="space-y-1">
          <SidebarItem href="/admin/content/threads" label="帖子管理" active={location.pathname === '/admin/content/threads'} />
          <SidebarItem href="/admin/content/replies" label="回帖管理" active={location.pathname === '/admin/content/replies'} />
        </div>
      );
    }
    return (
      <div className="space-y-1">
        <SidebarItem href="/admin/dashboard" label="系统信息" active={location.pathname === '/admin/dashboard'} />
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* 顶部导航栏 */}
      <header className="bg-slate-800 text-white shadow-lg sticky top-0 z-50">
        <div className="max-w-[1400px] mx-auto h-14 flex items-center justify-between px-4">
          <div className="flex items-center space-x-8">
            <h1 className="text-lg font-bold tracking-wide">ServerlessDiscuz! 管理后台</h1>
            <nav className="flex items-center space-x-1">
              {mainNavItems.map(item => (
                <Link
                  key={item.href}
                  to={item.href}
                  className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    location.pathname.startsWith(item.href) 
                      ? 'bg-slate-700 text-white' 
                      : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          
          <div className="flex items-center space-x-4">
            <Link 
              to='/' 
              target='_blank' 
              className="flex items-center space-x-1 text-slate-300 hover:text-white transition-colors text-sm"
            >
              <Home className="w-4 h-4" />
              <span>前台首页</span>
            </Link>
            <div className="h-4 w-px bg-slate-600"></div>
            <span className="text-sm text-slate-300">管理员: admin</span>
            <Button 
              onClick={handleLogout} 
              variant="ghost" 
              size="sm"
              className="text-slate-300 hover:text-white hover:bg-slate-700"
            >
              <LogOut className="w-4 h-4 mr-1" />
              退出
            </Button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 max-w-[1400px] mx-auto w-full">
        {/* 左侧导航栏 */}
        <aside className="w-56 shrink-0 bg-white border-r border-gray-200 py-6">
          <div className="px-4 mb-6">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              {getSectionTitle(location.pathname)}
            </h2>
          </div>
          <nav className="px-2">
            {renderSidebarNav()}
          </nav>
        </aside>

        {/* 主内容区 */}
        <main className="flex-1 p-6 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
};

// 侧边栏子项组件
const SidebarItem = ({ href, label, active }: { href: string; label: string; active: boolean }) => (
  <Link
    to={href}
    className={`block px-3 py-2 rounded-md text-sm transition-colors ${
      active 
        ? 'bg-blue-50 text-blue-600 font-medium' 
        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
    }`}
  >
    {label}
  </Link>
);

// 获取当前板块标题
const getSectionTitle = (pathname: string) => {
  if (pathname.startsWith('/admin/setting')) return '论坛设置';
  if (pathname.startsWith('/admin/users')) return '用户管理';
  if (pathname.startsWith('/admin/content')) return '内容管理';
  return '系统信息';
};

export default AdminLayout;
