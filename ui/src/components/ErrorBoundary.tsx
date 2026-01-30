import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { AlertCircle, RefreshCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-[400px] flex items-center justify-center p-4">
          <div className="text-center max-w-md">
            <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-gray-800 mb-2">出错了</h2>
            <p className="text-gray-600 mb-4">
              页面加载时发生错误，请刷新页面重试。
            </p>
            {this.state.error && (
              <div className="bg-gray-100 p-3 rounded text-left mb-4 text-sm text-gray-700 overflow-auto max-h-32">
                <strong>错误信息：</strong>
                <br />
                {this.state.error.message}
              </div>
            )}
            <Button 
              onClick={this.handleRetry}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <RefreshCcw className="w-4 h-4 mr-2" />
              刷新页面
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
