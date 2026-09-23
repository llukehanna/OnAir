import type { Page, Browser, BrowserContext } from 'playwright'

export function createMockPage(overrides?: Partial<Page>): Page {
  const mockContext = {
    clearCookies: jest.fn().mockResolvedValue(undefined),
  } as unknown as BrowserContext

  return {
    evaluate: jest.fn().mockResolvedValue(undefined),
    goto: jest.fn().mockResolvedValue(null),
    title: jest.fn().mockResolvedValue(''),
    url: jest.fn().mockReturnValue('about:blank'),
    context: jest.fn().mockReturnValue(mockContext),
    close: jest.fn().mockResolvedValue(undefined),
    isClosed: jest.fn().mockReturnValue(false),
    ...overrides,
  } as unknown as Page
}

export function createMockBrowserFactory(): () => Promise<Browser> {
  return async () => ({
    newContext: jest.fn().mockImplementation(async () => ({
      newPage: jest.fn().mockImplementation(async () => createMockPage()),
      clearCookies: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
    })),
    close: jest.fn().mockResolvedValue(undefined),
    contexts: jest.fn().mockReturnValue([]),
  } as unknown as Browser)
}
