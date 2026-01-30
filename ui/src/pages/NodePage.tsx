import { useEffect, useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { apiClient } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { useAuth } from '@/hooks/useAuth';
import { usePagination } from '@/hooks/useDebounce';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ErrorAlert } from '@/components/ErrorAlert';
import Pagination from '@/components/Pagination';
import File from 'lucide-react/dist/esm/icons/file';
import Lightbulb from 'lucide-react/dist/esm/icons/lightbulb';

interface Thread {
  id: number;
  title: string;
  author_id: number;
  author_username: string;
  created_at: number;
  reply_count: number;
  view_count: number;
  last_reply_id: number;
  last_reply_at: number | null;
  last_reply_username: string | null;
  last_reply_user_id: string | null;
  is_pinned?: boolean;
}

interface Node {
  id: number;
  name: string;
  description: string;
}

interface ThreadsResponse {
  data: Thread[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export default function NodePage() {
  const { nodeId } = useParams<{ nodeId: string }>();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [node, setNode] = useState<Node | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const pagination = usePagination(1, 20);

  const fetchThreadsAndNode = useCallback(async () => {
    if (!nodeId) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const [threadsRes, nodeData] = await Promise.all([
        apiClient.get<ThreadsResponse>(`/threads?nodeId=${nodeId}&page=${pagination.page}&pageSize=${pagination.pageSize}`),
        apiClient.get<Node>(`/nodes/${nodeId}`)
      ]);
      
      setThreads(threadsRes.data);
      pagination.setTotal(threadsRes.pagination.total);
      setNode(nodeData);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '加载失败';
      setError(errorMessage);
      console.error('Failed to fetch threads:', err);
    } finally {
      setLoading(false);
    }
  }, [nodeId, pagination.page, pagination.pageSize]);

  useEffect(() => {
    fetchThreadsAndNode();
  }, [fetchThreadsAndNode]);

  if (loading && threads.length === 0) {
    return (
      <div className="max-w-[1200px] mx-auto">
        <LoadingSpinner text="正在加载版块内容..." />
      </div>
    );
  }

  if (error && threads.length === 0) {
    return (
      <div className="max-w-[1200px] mx-auto py-10">
        <ErrorAlert 
          type="error"
          title="加载失败"
          message={error}
          onRetry={fetchThreadsAndNode}
        />
      </div>
    );
  }

  if (!node) {
    return (
      <div className="max-w-[1200px] mx-auto py-10">
        <ErrorAlert 
          type="warning"
          title="版块未找到"
          message="该版块不存在或已被删除"
        />
      </div>
    );
  }

  return (
    <div className="max-w-[1200px] mx-auto w-full space-y-4">
      {/* 版块标题和操作 */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-800">{node.name}</h1>
          {node.description && (
            <p className="text-sm text-gray-500 mt-1">{node.description}</p>
          )}
        </div>
        <Button 
          className="bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm px-4 h-9 shrink-0"
          onClick={() => navigate(isAuthenticated ? `/nodes/${nodeId}/new` : '/auth')}
        >
          <File className="w-4 h-4 mr-2" />
          发帖
        </Button>
      </div>

      {/* 帖子列表 */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
        {/* 表头 */}
        <div className="bg-gray-50 border-b border-gray-200 px-4 py-3 hidden md:flex text-sm font-semibold text-gray-600">
          <div className="flex-1 pl-2">标题</div>
          <div className="w-28 shrink-0 text-left">作者</div>
          <div className="w-24 shrink-0 text-center">回复/查看</div>
          <div className="w-36 shrink-0 text-right">最后发表</div>
        </div>

        {/* 帖子内容 */}
        <div className="divide-y divide-gray-100">
          {threads.length === 0 ? (
            <div className="py-12 text-center text-gray-500">
              <File className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>该版块暂无帖子</p>
              <p className="text-sm mt-1">快来发布第一个帖子吧！</p>
            </div>
          ) : (
            threads.map(thread => (
              <div 
                key={thread.id} 
                className="p-3 md:p-4 flex flex-col md:flex-row md:items-center gap-2 md:gap-0 hover:bg-gray-50 transition-colors"
              >
                {/* 标题 */}
                <div className="flex-1 flex items-center min-w-0">
                  {thread.is_pinned ? (
                    <Lightbulb className="mr-2 h-4 w-4 text-orange-500 shrink-0" />
                  ) : (
                    <File className="mr-2 h-4 w-4 text-gray-400 shrink-0" />
                  )}
                  <Link 
                    to={`/threads/${thread.id}`} 
                    className="text-gray-800 hover:text-blue-600 hover:underline truncate font-medium"
                  >
                    {thread.title}
                  </Link>
                  {thread.is_pinned && (
                    <span className="ml-2 px-2 py-0.5 bg-orange-100 text-orange-700 text-xs rounded shrink-0">
                      置顶
                    </span>
                  )}
                </div>

                {/* 作者 - 移动端显示 */}
                <div className="md:hidden flex items-center text-xs text-gray-500">
                  <Link to={`/users/${thread.author_id}`} className="text-blue-600 hover:underline">
                    {thread.author_username}
                  </Link>
                  <span className="mx-2">•</span>
                  <span>{formatDistanceToNow(new Date(thread.created_at * 1000), { addSuffix: true, locale: zhCN })}</span>
                </div>

                {/* 作者 - 桌面端 */}
                <div className="hidden md:block w-28 shrink-0 text-left text-xs">
                  <Link to={`/users/${thread.author_id}`} className="text-blue-600 hover:underline block truncate">
                    {thread.author_username}
                  </Link>
                  <span className="text-gray-400">
                    {formatDistanceToNow(new Date(thread.created_at * 1000), { addSuffix: true, locale: zhCN })}
                  </span>
                </div>

                {/* 回复/查看 */}
                <div className="w-auto md:w-24 shrink-0 text-left md:text-center text-xs">
                  <span className="text-red-500 font-medium">{thread.reply_count}</span>
                  <span className="text-gray-400"> / {thread.view_count}</span>
                </div>

                {/* 最后发表 */}
                <div className="hidden md:block w-36 shrink-0 text-right text-xs">
                  {thread.last_reply_at ? (
                    <>
                      <Link 
                        to={`/users/${thread.last_reply_user_id}`} 
                        className="block text-blue-600 hover:underline truncate"
                      >
                        {thread.last_reply_username}
                      </Link>
                      <Link 
                        to={`/threads/${thread.id}#reply-${thread.last_reply_id}`} 
                        className="block text-gray-400 hover:underline"
                      >
                        {formatDistanceToNow(new Date(thread.last_reply_at * 1000), { addSuffix: true, locale: zhCN })}
                      </Link>
                    </>
                  ) : (
                    <span className="text-gray-400">暂无回复</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* 分页 */}
        <Pagination
          currentPage={pagination.page}
          totalPages={pagination.totalPages}
          totalItems={pagination.total}
          pageSize={pagination.pageSize}
          onPageChange={pagination.setPage}
        />
      </div>
    </div>
  );
}
