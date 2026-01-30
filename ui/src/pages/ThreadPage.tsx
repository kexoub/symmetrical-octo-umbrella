import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { apiClient } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { useToast } from "@/components/ui/use-toast";
import { format } from 'date-fns';
import { RichTextEditor } from '@/components/RichTextEditor';
import type { ThreadWithDetails, PollOption, UserVote, Reply } from '../types';
import defaultAvatar from '@/img/default_avatar.svg';
import Mail from 'lucide-react/dist/esm/icons/mail';
import Lock from 'lucide-react/dist/esm/icons/lock';
import MessageSquareQuote from 'lucide-react/dist/esm/icons/message-square-quote';
import Pen from 'lucide-react/dist/esm/icons/pen';
import Loader2 from 'lucide-react/dist/esm/icons/loader2';
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';

// --- 常量定义 ---
const REPLIES_PER_PAGE = 20;

// --- 加载状态组件 ---
const LoadingSpinner = ({ message = '正在加载...' }: { message?: string }) => (
  <div className="max-w-[960px] mx-auto text-center py-10">
    <div className="flex flex-col items-center justify-center space-y-4">
      <Loader2 className="w-8 h-8 animate-spin text-[#336699]" />
      <p className="text-gray-600 text-sm">{message}</p>
    </div>
  </div>
);

// --- 错误处理组件 ---
interface ErrorMessageProps {
  message: string;
  onRetry?: () => void;
}

const ErrorMessage = ({ message, onRetry }: ErrorMessageProps) => (
  <div className="max-w-[960px] mx-auto text-center py-10 px-4">
    <div className="flex flex-col items-center justify-center space-y-4">
      <AlertCircle className="w-12 h-12 text-red-500" />
      <p className="text-gray-800 font-medium">加载失败</p>
      <p className="text-gray-600 text-sm max-w-md">{message}</p>
      {onRetry && (
        <Button 
          onClick={onRetry} 
          variant="outline" 
          className="mt-4"
        >
          重试
        </Button>
      )}
    </div>
  </div>
);

// --- 分页组件 ---
interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  totalItems: number;
}

const Pagination = ({ currentPage, totalPages, onPageChange, totalItems }: PaginationProps) => {
  if (totalPages <= 1) return null;

  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    const maxVisible = 5;
    
    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      if (currentPage <= 3) {
        for (let i = 1; i <= 4; i++) pages.push(i);
        pages.push('...');
        pages.push(totalPages);
      } else if (currentPage >= totalPages - 2) {
        pages.push(1);
        pages.push('...');
        for (let i = totalPages - 3; i <= totalPages; i++) pages.push(i);
      } else {
        pages.push(1);
        pages.push('...');
        pages.push(currentPage - 1);
        pages.push(currentPage);
        pages.push(currentPage + 1);
        pages.push('...');
        pages.push(totalPages);
      }
    }
    return pages;
  };

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between px-4 py-3 bg-white border border-[#CDCDCD] border-t-0">
      <div className="text-sm text-gray-600 mb-2 sm:mb-0">
        共 <span className="font-medium">{totalItems}</span> 条回复，
        第 <span className="font-medium">{currentPage}</span> / {totalPages} 页
      </div>
      <div className="flex items-center space-x-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="h-8 w-8 p-0"
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>
        
        {getPageNumbers().map((page, index) => (
          <React.Fragment key={index}>
            {page === '...' ? (
              <span className="px-2 text-gray-400">...</span>
            ) : (
              <Button
                variant={currentPage === page ? "default" : "outline"}
                size="sm"
                onClick={() => onPageChange(page as number)}
                className={`h-8 w-8 p-0 text-xs ${
                  currentPage === page 
                    ? 'bg-[#336699] hover:bg-[#2366A8] text-white' 
                    : ''
                }`}
              >
                {page}
              </Button>
            )}
          </React.Fragment>
        ))}
        
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className="h-8 w-8 p-0"
        >
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
};

// --- 子组件 ---

// 投票组件
const PollComponent = ({ threadId, options, userVote, onVoted }: { threadId: number, options: PollOption[], userVote?: UserVote, onVoted: () => void }) => {
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const totalVotes = options.reduce((sum, opt) => sum + opt.vote_count, 0);
  const hasVoted = !!userVote;
  const { toast } = useToast();

  const handleSubmitVote = useCallback(async () => {
    if (selectedOption === null) {
      toast({ title: "提示", description: "请选择一个选项再提交。" });
      return;
    }
    try {
      await apiClient.post(`/threads/${threadId}/vote`, { optionId: selectedOption });
      onVoted();
    } catch (error: any) {
      const description = error?.message || (typeof error === 'string' ? error : "出错了，请稍后再试。");
      toast({
        title: "投票失败",
        description: description,
      });
      console.error(error);
    }
  }, [selectedOption, threadId, onVoted, toast]);

  const barColors = ['bg-red-500', 'bg-orange-400', 'bg-amber-400', 'bg-green-500', 'bg-sky-500', 'bg-indigo-500'];

  return (
    <div className="my-4 border border-[#E5EDF2] bg-[#F5FAFE] text-sm">
      <div className="p-4 border-b border-[#E5EDF2]">
        <p className="font-bold">单选投票: <span className="font-normal text-gray-500">(共有 {totalVotes} 人参与投票)</span></p>
      </div>
      <div className="p-4 space-y-4">
        {options.map((opt, index) => {
          const percentage = totalVotes > 0 ? (opt.vote_count / totalVotes) * 100 : 0;
          return (
            <div key={opt.id}>
              <input type="radio" id={`poll-option-${opt.id}`} name="poll-vote" disabled={hasVoted} value={opt.id} onChange={() => setSelectedOption(opt.id)} className="mr-2 h-4 w-4" />
              <label htmlFor={`poll-option-${opt.id}`}>{opt.option_text}</label>
              <div className="flex items-center space-x-3">
                <div className="w-full bg-gray-200 h-3">
                  <div
                    className={`${barColors[index % barColors.length]} h-3`}
                    style={{ width: `${percentage}%` }}
                  ></div>
                </div>
                <span className="text-xs text-gray-500 w-28 text-left shrink-0">
                  {percentage.toFixed(2)}% (<strong className="text-red-500">{opt.vote_count}</strong>)
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="p-4 border-t border-[#E5EDF2]">
        {hasVoted ? (
          <p className="text-gray-500 text-sm">您已经投过票, 谢谢您的参与</p>
        ) : (
          <Button size="sm" className="h-7 px-4 text-sm bg-[#336699] hover:bg-[#2366A8]" onClick={handleSubmitVote}>提交</Button>
        )}
      </div>
    </div>
  );
};

// 私密回复的占位符组件
const PrivateReplyPlaceholder = () => (
  <div className="border border-dashed border-red-300 bg-red-50 p-2 text-center text-sm text-red-700">
    <Lock className='w-[16px] h-[16px] inline mr-1' />
    此帖仅作者可见
  </div>
);

interface PostProps {
  type: 'thread' | 'reply';
  post: (any | ThreadWithDetails | Reply) & { author_username: string, author_avatar?: string, body: string, created_at: number, is_author_only?: boolean };
  isOp?: boolean;
  floor: number;
  onQuote: () => void;
  onVoted?: () => void;
  canViewPrivate: boolean;
}

const Post = ({ type, post, isOp, floor, onQuote, onVoted, canViewPrivate }: PostProps) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  
  const handleSendMessage = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    navigate('/notifications', { state: { newConversationWith: post.author_username } });
  }, [navigate, post.author_username]);

  const avatarUrl = post.author_avatar ? post.author_avatar : defaultAvatar;
  const hasQuote = 'quoted_author' in post && post.quoted_author;
  const isPrivateAndHidden = !canViewPrivate;

  return (
    <div className="bg-white border-x border-[#CDCDCD] border-b-4 border-b-[#C2D5E3] flex flex-col md:flex-row">
      {/* 左侧用户信息 - 移动端优化 */}
      <div className="w-full md:w-40 shrink-0 border-b md:border-b-0 md:border-r bg-[#E5EDF2] pt-2 pb-4 md:pb-8 text-left text-xs">
        <div className="flex md:block items-center px-4 md:px-4 pb-2 md:pb-3 md:mb-4 border-b border-dashed border-b-[#cdcdcd]">
          <Link to={`/users/${post.author_id}`} className="font-bold text-base text-[#336699] hover:underline mr-2 md:mr-0">
            {post.author_username}
          </Link>
          <span className="md:hidden text-gray-500">· 中级会员</span>
        </div>
        <div className="hidden md:block my-2 px-4">
          <Link to={`/users/${post.author_id}`}>
            <img src={avatarUrl} className="mx-auto w-full max-w-[120px] object-cover" alt="avatar" loading="lazy" />
          </Link>
        </div>
        <div className='hidden md:block px-4'>
          <p>中级会员</p>
          <div className="my-2 space-y-1">
            <p>主题: 15</p>
            <p>回帖: 136</p>
            <p>积分: 340</p>
          </div>
          <a className="inline-flex text-xs cursor-pointer text-[#369] hover:underline" onClick={handleSendMessage}>
            <Mail className='text-[#369] w-[15px]' />
            发消息
          </a>
        </div>
      </div>
      
      {/* 右侧内容区域 */}
      <div className="w-full p-2 px-4 bg-white" id={`reply-${post.id}`}>
        <div className="flex justify-between items-center text-xs text-gray-500 border-b border-dashed border-[#E5EDF2] pb-2 mb-4">
          <span>发表于: {format(new Date(post.created_at * 1000), 'yyyy-MM-dd HH:mm:ss')}</span>
          <div>{isOp && <span className="mr-2">楼主</span>}<span className="font-bold text-lg">#{floor}</span></div>
        </div>

        {isPrivateAndHidden ? (
          <PrivateReplyPlaceholder />
        ) : (
          <div className="prose prose-sm max-w-none text-base leading-relaxed min-h-[120px] md:min-h-[220px] text-[14px]" dangerouslySetInnerHTML={{ __html: post.body }} />
        )}

        {isOp && post.type === 'poll' && post.poll_options && onVoted && (
          <PollComponent
            threadId={post.id}
            options={post.poll_options}
            userVote={post.user_vote}
            onVoted={onVoted}
          />
        )}

        {hasQuote && (
          <blockquote className="bg-[#F5FAFE] border border-[#E5EDF2] p-3 my-4 text-sm text-gray-600">
            <p><strong>{post.quoted_author}</strong> 发表于 {format(new Date((post.quoted_created_at || 0) * 1000), 'yyyy-MM-dd HH:mm')}</p>
            <div className="mt-2" dangerouslySetInnerHTML={{ __html: post.quoted_body || '' }} />
          </blockquote>
        )}

        <div className="mt-4 space-x-4">
          {(!isOp && !isPrivateAndHidden) && (
            <Button onClick={onQuote} size="sm" variant="ghost" className="text-xs text-gray-500 hover:text-gray-900 px-0">
              <MessageSquareQuote className='w-[18px] mr-1' />
              回复
            </Button>
          )}
          {user && user.id == post.author_id && (
            <Link to={type === `thread` ? `/threads/${post.id}/update` : `/threads/${post.thread_id}/replies/${post.id}/update`} className="text-xs text-gray-500 hover:text-gray-900 px-0 inline-flex items-center">
              <Pen className='w-[15px] mr-1' />
              编辑
            </Link>
          )}
        </div>
      </div>
    </div>
  );
};

interface QuickReplyFormProps {
  threadId: string;
  onReplyPosted: () => void;
  quotingReply: Reply | null;
  clearQuoting: () => void;
}

const QuickReplyForm = ({ threadId, onReplyPosted, quotingReply, clearQuoting }: QuickReplyFormProps) => {
  const { isAuthenticated, user } = useAuth();
  const [body, setBody] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const avatarUrl = user?.avatar ? user.avatar : defaultAvatar;

  const handleSubmit = useCallback(async () => {
    if (!body.trim() || body === '<br>') return;
    
    setIsSubmitting(true);
    try {
      await apiClient.post(`/threads/${threadId}/replies`, { body, replyToId: quotingReply ? quotingReply.id : null });
      toast({ title: "成功", description: "回复已发布。" });
      setBody('');
      clearQuoting();
      onReplyPosted();
    } catch (error: any) {
      toast({ title: "错误", description: error.message || "发布失败", });
    } finally {
      setIsSubmitting(false);
    }
  }, [body, threadId, quotingReply, clearQuoting, onReplyPosted, toast]);

  if (!isAuthenticated) return null;
  
  return (
    <>
      <div className="hidden md:block w-40 shrink-0 border-r border-[#E5EDF2] p-4 text-center text-xs bg-[#F5FAFE]">
        <a href="#" className="font-bold text-base text-[#336699]">{user?.username}</a>
        <div className="my-2">
          <img src={avatarUrl} className="mx-auto w-full max-w-[120px] object-cover" alt="avatar" />
        </div>
      </div>
      <div className="w-full bg-white p-4">
        {quotingReply && (
          <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-2 text-xs mb-2">
            正在回复: <strong>{quotingReply.author_username}</strong> 的帖子 
            <button onClick={clearQuoting} className="float-right font-bold hover:text-black">取消</button>
          </div>
        )}
        <RichTextEditor value={body} onChange={setBody} />
        <div className="mt-2">
          <Button 
            onClick={handleSubmit} 
            disabled={isSubmitting}
            className="bg-[#0066CC] hover:bg-[#0055AA] text-white text-sm px-6 h-8 font-bold disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                发表中...
              </>
            ) : '发表回复'}
          </Button>
        </div>
      </div>
    </>
  );
};

// --- 主页面组件 ---
export default function ThreadPage() {
  const { threadId } = useParams<{ threadId: string }>();
  const [thread, setThread] = useState<ThreadWithDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [quotingReply, setQuotingReply] = useState<Reply | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const replyFormRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const { user } = useAuth();

  // 计算分页数据
  const { paginatedReplies, totalPages, totalReplies } = useMemo(() => {
    if (!thread?.replies) {
      return { paginatedReplies: [], totalPages: 0, totalReplies: 0 };
    }
    
    const total = thread.replies.length;
    const totalPages = Math.ceil(total / REPLIES_PER_PAGE);
    const startIndex = (currentPage - 1) * REPLIES_PER_PAGE;
    const endIndex = startIndex + REPLIES_PER_PAGE;
    
    return {
      paginatedReplies: thread.replies.slice(startIndex, endIndex),
      totalPages,
      totalReplies: total
    };
  }, [thread?.replies, currentPage]);

  const fetchThread = useCallback(async () => {
    if (!threadId) return;
    setLoading(true);
    setError(null);
    
    try {
      const data = await apiClient.get<ThreadWithDetails>(`/threads/${threadId}`);
      setThread(data);
      
      // 处理 URL hash 定位
      if (location.hash) {
        const hash = location.hash;
        location.hash = ``;
        setTimeout(() => {
          location.hash = hash;
        }, 50);
      }
    } catch (error: any) {
      const errorMessage = error?.message || "加载帖子失败，请稍后重试";
      setError(errorMessage);
      toast({ title: "加载失败", description: errorMessage });
    } finally {
      setLoading(false);
    }
  }, [threadId, toast]);

  useEffect(() => {
    fetchThread();
  }, [fetchThread]);

  // 页面切换时滚动到顶部
  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // 回复后刷新并重置到最后一页
  const handleReplyPosted = useCallback(() => {
    fetchThread();
    // 计算最后一页
    if (thread?.replies) {
      const lastPage = Math.ceil((thread.replies.length + 1) / REPLIES_PER_PAGE);
      setCurrentPage(lastPage);
    }
  }, [fetchThread, thread?.replies]);

  const handleSetQuoting = useCallback((reply: Reply) => {
    setQuotingReply(reply);
    replyFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  const clearQuoting = useCallback(() => {
    setQuotingReply(null);
  }, []);

  if (loading) return <LoadingSpinner message="正在加载帖子..." />;
  
  if (error) return <ErrorMessage message={error} onRetry={fetchThread} />;
  
  if (!thread) return <ErrorMessage message="未找到该帖子或帖子已被删除" />;

  return (
    <div className="max-w-[960px] mx-auto w-full space-y-0 px-2 md:px-0">
      {/* 帖子头部信息 */}
      <div className="bg-white border border-[#CDCDCD] border-r-[#C2D5E3] border-b-4 border-b-[#C2D5E3] flex flex-col md:flex-row">
        <div className="w-full md:w-40 shrink-0 border-b md:border-b-0 md:border-r bg-[#E5EDF2] p-2 md:p-4 text-center text-xs text-[#999]">
          <span className="hidden md:inline">查看:</span>
          <span className='text-[#F26C4F] mr-1 md:ml-1'>3228</span>
          <span className="hidden md:inline">|</span>
          <span className="md:hidden mx-1">·</span>
          <span className="hidden md:inline">回复:</span>
          <span className='text-[#F26C4F] md:ml-1'>{totalReplies}</span>
        </div>
        <div className="w-full px-2 py-3 bg-white" id="reply-3">
          <h1 className="font-bold break-words px-2 text-[16px] leading-tight">{thread.title}</h1>
        </div>
      </div>

      {/* 主贴 */}
      <Post
        type="thread"
        post={thread}
        isOp={true}
        floor={1}
        onQuote={() => {}}
        onVoted={fetchThread}
        canViewPrivate={true}
      />

      {/* 分页控件 - 顶部 */}
      <Pagination 
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={handlePageChange}
        totalItems={totalReplies}
      />

      {/* 回复列表 */}
      {paginatedReplies.map((reply: Reply, index: number) => {
        const canView = !!(user && (user.id === reply.author_id || user.id === thread.author_id));
        const floor = (currentPage - 1) * REPLIES_PER_PAGE + index + 2;
        
        return (
          <Post
            type="reply"
            key={`${reply.id}-${currentPage}`}
            post={reply}
            floor={floor}
            onQuote={() => handleSetQuoting(reply)}
            canViewPrivate={canView}
          />
        );
      })}

      {/* 分页控件 - 底部 */}
      <Pagination 
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={handlePageChange}
        totalItems={totalReplies}
      />

      {/* 快速回复表单 */}
      <div ref={replyFormRef} className="border border-[#CDCDCD] border-t-0 flex flex-col md:flex-row mt-4">
        <QuickReplyForm
          threadId={threadId!}
          onReplyPosted={handleReplyPosted}
          quotingReply={quotingReply}
          clearQuoting={clearQuoting}
        />
      </div>
    </div>
  );
}
