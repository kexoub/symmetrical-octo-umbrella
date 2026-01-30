import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Breadcrumbs from '@/components/Breadcrumbs';
import { Select, SelectContent, SelectTrigger, SelectValue } from './ui/select';
import { SelectItem } from '@radix-ui/react-select';
import Search from 'lucide-react/dist/esm/icons/search';
import AuthPage from '@/pages/AuthPage';
import defaultAvatar from '@/img/default_avatar.svg';
import { toast } from './ui/use-toast';
import { useConfig } from '@/contexts/ConfigContext';

export default function Layout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user, logout } = useAuth();
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [searchType, setSearchType] = useState('threads');
  const { rpName, rpSubtitle } = useConfig();

  const handleSearch = () => {
    if (!searchTerm.trim()) return;
    navigate(`/search?q=${encodeURIComponent(searchTerm)}&type=${searchType}`);
  };

  const handleLogout = (e: React.MouseEvent) => {
    e.preventDefault();
    logout();
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* 顶部用户信息栏 */}
      <div className="bg-white border-b border-gray-200 text-xs">
        <div className="max-w-[1200px] mx-auto h-8 flex justify-between items-center px-4 text-gray-600">
          <div className="flex items-center space-x-4">
            <span className="text-gray-500">欢迎来到 {rpName}</span>
          </div>
          <div className="flex items-center space-x-4">
            <button
              className="hover:text-blue-600 transition-colors"
              onClick={(e) => {
                e.preventDefault();
                toast({ title: "提示", description: "请按 Ctrl+D 键添加到收藏夹" });
              }}
            >
              收藏本站
            </button>
          </div>
        </div>
      </div>

      {/* 主 Logo 和搜索栏 */}
      <div className="bg-white py-6 shadow-sm">
        <div className="max-w-[1200px] mx-auto flex justify-between items-center px-4">
          <Link to="/" className="flex-shrink-0 group">
            <h1 className="text-3xl font-bold text-blue-600 tracking-tight group-hover:text-blue-700 transition-colors">{rpName}</h1>
            <p className="text-xs text-gray-500 mt-1">{rpSubtitle}</p>
          </Link>
          
          {isAuthenticated && user ? (
            <div className="flex items-center space-x-4">
              <div className="text-right">
                <div className="flex items-center space-x-2 text-sm">
                  <span className="font-semibold text-gray-800">{user.username}</span>
                  <span className="text-green-500 text-xs">● 在线</span>
                </div>
                <div className="flex items-center space-x-2 text-xs text-gray-500 mt-1">
                  <Link to="/settings" className="hover:text-blue-600 transition-colors">设置</Link>
                  <span>|</span>
                  {user.role === 'admin' && (
                    <>
                      <Link to="/admin/dashboard" target='_blank' className="hover:text-blue-600 transition-colors">后台</Link>
                      <span>|</span>
                    </>
                  )}
                  <Link to="/notifications" className="hover:text-blue-600 transition-colors">消息</Link>
                  <span>|</span>
                  <button onClick={handleLogout} className="hover:text-red-600 transition-colors">退出</button>
                </div>
              </div>
              <Link to={`/users/${user.id}`} className="shrink-0">
                <img 
                  src={user.avatar ? user.avatar : defaultAvatar} 
                  className="w-12 h-12 rounded-full border-2 border-gray-200 object-cover hover:border-blue-400 transition-colors" 
                  alt="avatar" 
                />
              </Link>
            </div>
          ) : (
            <AuthPage />
          )}
        </div>
      </div>

      {/* 主导航 */}
      <div className="bg-blue-600 text-white shadow-md">
        <div className="max-w-[1200px] mx-auto h-12 flex justify-between items-center px-4">
          <div className="flex items-center space-x-1">
            <Link to="/" className="h-12 px-4 flex items-center font-bold text-sm hover:bg-blue-700 transition-colors">
              论坛首页
            </Link>
            <Link to="/rankings" className="h-12 px-4 flex items-center text-sm hover:bg-blue-700 transition-colors">
              排行榜
            </Link>
          </div>
          
          {/* 搜索栏 */}
          <div className="flex items-center">
            <div className="flex">
              <Input
                type="text"
                placeholder="搜索..."
                className="w-48 h-8 text-sm rounded-r-none bg-white border-0 focus:ring-2 focus:ring-blue-400"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              />
              <Select value={searchType} onValueChange={setSearchType}>
                <SelectTrigger className="w-20 h-8 rounded-none text-xs border-0 bg-gray-100">
                  {searchType === 'threads' ? '帖子' : '用户'}
                </SelectTrigger>
                <SelectContent className='bg-white'>
                  <SelectItem className='cursor-pointer text-xs' value="threads">帖子</SelectItem>
                  <SelectItem className='cursor-pointer text-xs' value="users">用户</SelectItem>
                </SelectContent>
              </Select>
              <Button 
                className="h-8 bg-blue-800 hover:bg-blue-900 rounded-l-none px-3" 
                onClick={handleSearch}
              >
                <Search className='w-4 h-4' />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* 面包屑导航 */}
      <div className="bg-gray-100 border-b border-gray-200">
        <div className="max-w-[1200px] mx-auto px-4">
          <Breadcrumbs />
        </div>
      </div>

      {/* 主内容区 */}
      <main className="flex-grow w-full py-6">
        <div className="max-w-[1200px] mx-auto px-4">
          {children}
        </div>
      </main>

      {/* 页脚 */}
      <footer className="bg-white border-t border-gray-200 mt-auto">
        <div className="max-w-[1200px] mx-auto py-6 px-4">
          <div className="text-center text-xs text-gray-500 space-y-2">
            <p>
              Powered by{' '}
              <a 
                href="https://github.com/serverless-bbs/serverless-bbs" 
                className='font-semibold text-blue-600 hover:underline' 
                target="_blank"
                rel="noopener noreferrer"
              >
                ServerlessDiscuz!
              </a>
            </p>
            <p>
              <span className='inline-block' style={{ transform: 'rotate(180deg)' }}>©</span>
              {' '}2004-2025 Inspired by{' '}
              <a href='https://www.comsenz.com' target='_blank' rel="noopener noreferrer" className="hover:underline">Comsenz</a>
              {' '}| Hosted on{' '}
              <a href='https://www.cloudflare.com' target='_blank' rel="noopener noreferrer" className="hover:underline">Cloudflare</a>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
