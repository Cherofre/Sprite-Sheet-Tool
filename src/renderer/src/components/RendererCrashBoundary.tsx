import { Component, type ErrorInfo, type ReactNode } from 'react'

interface RendererCrashBoundaryProps {
  children: ReactNode
}

interface RendererCrashBoundaryState {
  details: string | null
  error: Error | null
}

const toError = (value: unknown): Error => {
  if (value instanceof Error) {
    return value
  }

  if (typeof value === 'string') {
    return new Error(value)
  }

  return new Error('Unknown renderer error.')
}

export class RendererCrashBoundary extends Component<RendererCrashBoundaryProps, RendererCrashBoundaryState> {
  state: RendererCrashBoundaryState = {
    details: null,
    error: null
  }

  private readonly handleWindowError = (event: ErrorEvent): void => {
    if (!this.state.error) {
      this.setState({
        details: event.message || null,
        error: toError(event.error ?? event.message)
      })
    }
  }

  private readonly handleUnhandledRejection = (event: PromiseRejectionEvent): void => {
    if (!this.state.error) {
      const error = toError(event.reason)
      this.setState({
        details: error.stack ?? null,
        error
      })
    }
  }

  static getDerivedStateFromError(error: Error): RendererCrashBoundaryState {
    return {
      details: error.stack ?? null,
      error
    }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Renderer crash boundary caught an error.', error, info)
    this.setState((state) => ({
      details: state.details ?? info.componentStack ?? error.stack ?? null
    }))
  }

  override componentDidMount(): void {
    window.addEventListener('error', this.handleWindowError)
    window.addEventListener('unhandledrejection', this.handleUnhandledRejection)
  }

  override componentWillUnmount(): void {
    window.removeEventListener('error', this.handleWindowError)
    window.removeEventListener('unhandledrejection', this.handleUnhandledRejection)
  }

  private readonly handleReload = (): void => {
    window.location.reload()
  }

  override render() {
    if (!this.state.error) {
      return this.props.children
    }

    return (
      <div className="fatal-screen">
        <div className="fatal-card">
          <span className="eyebrow">渲染异常</span>
          <h1>界面刚刚崩掉了，但主窗口还在。</h1>
          <p>这通常是渲染层异常或开发态热更新中断造成的。你可以直接重载界面继续工作。</p>
          <pre>{this.state.details ?? this.state.error.message}</pre>
          <div className="fatal-card-actions">
            <button className="primary-button" onClick={this.handleReload} type="button">
              重新加载界面
            </button>
          </div>
        </div>
      </div>
    )
  }
}
