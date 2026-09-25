import { useState, useEffect } from 'react';

/**
 * Breakpoints для судейского приложения (соответствуют tailwind.config.js)
 */
export const BREAKPOINTS = {
  sm: 640,    // Tailwind default
  md: 768,    // Tailwind default
  lg: 1024,   // Tailwind default
  xl: 1280,   // Tailwind default
  '2xl': 1536, // Tailwind default
  hd: 1366,   // HD минимум для судейских столов
  fhd: 1920,  // Full HD - основное разрешение
  '2k': 2560, // 2K/QHD для публичных табло
  '4k': 3840, // 4K/UHD для больших экранов
} as const;

export type Breakpoint = keyof typeof BREAKPOINTS;

/**
 * Результат хука useResponsive
 */
export interface ResponsiveState {
  width: number;
  height: number;
  // Tailwind стандартные breakpoints
  isSm: boolean;
  isMd: boolean;
  isLg: boolean;
  isXl: boolean;
  is2Xl: boolean;
  // Custom breakpoints
  isHD: boolean;
  isFHD: boolean;
  is2K: boolean;
  is4K: boolean;
  // Утилиты
  isPortrait: boolean;
  isLandscape: boolean;
  aspectRatio: number;
}

/**
 * Hook для определения текущего разрешения экрана и responsive состояния
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { isFHD, isHD, width } = useResponsive();
 *
 *   return (
 *     <div>
 *       {isFHD ? 'Full HD режим' : isHD ? 'HD режим' : 'Малый экран'}
 *       <p>Ширина: {width}px</p>
 *     </div>
 *   );
 * }
 * ```
 */
export function useResponsive(): ResponsiveState {
  const [state, setState] = useState<ResponsiveState>(() =>
    getResponsiveState(window.innerWidth, window.innerHeight)
  );

  useEffect(() => {
    const handleResize = () => {
      setState(getResponsiveState(window.innerWidth, window.innerHeight));
    };

    // Debounce resize для производительности
    let timeoutId: number;
    const debouncedResize = () => {
      clearTimeout(timeoutId);
      timeoutId = window.setTimeout(handleResize, 150);
    };

    window.addEventListener('resize', debouncedResize);
    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('resize', debouncedResize);
    };
  }, []);

  return state;
}

/**
 * Вычислить responsive состояние на основе ширины и высоты
 */
function getResponsiveState(width: number, height: number): ResponsiveState {
  return {
    width,
    height,
    // Tailwind стандартные breakpoints (>= условие)
    isSm: width >= BREAKPOINTS.sm,
    isMd: width >= BREAKPOINTS.md,
    isLg: width >= BREAKPOINTS.lg,
    isXl: width >= BREAKPOINTS.xl,
    is2Xl: width >= BREAKPOINTS['2xl'],
    // Custom breakpoints
    isHD: width >= BREAKPOINTS.hd,
    isFHD: width >= BREAKPOINTS.fhd,
    is2K: width >= BREAKPOINTS['2k'],
    is4K: width >= BREAKPOINTS['4k'],
    // Утилиты
    isPortrait: height > width,
    isLandscape: width > height,
    aspectRatio: width / height,
  };
}

/**
 * Hook для определения, находится ли экран в заданном breakpoint или выше
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const isLargeScreen = useBreakpoint('lg');
 *
 *   return (
 *     <div className={isLargeScreen ? 'text-2xl' : 'text-base'}>
 *       Адаптивный текст
 *     </div>
 *   );
 * }
 * ```
 */
export function useBreakpoint(breakpoint: Breakpoint): boolean {
  const { width } = useResponsive();
  return width >= BREAKPOINTS[breakpoint];
}

/**
 * Hook для определения текущего режима отображения (hd/fullhd)
 * Для адаптивного дизайна MatchScreen и TournamentBracket
 *
 * @returns 'hd' | 'fullhd'
 *
 * @example
 * ```tsx
 * function MatchScreen() {
 *   const mode = useDisplayMode();
 *
 *   const fontSize = {
 *     hd: 'text-xl',
 *     fullhd: 'text-3xl',
 *   }[mode];
 *
 *   return <div className={fontSize}>Имя бойца</div>;
 * }
 * ```
 */
export function useDisplayMode(): 'hd' | 'fullhd' {
  const { width } = useResponsive();

  // Breakpoint на 1440px (между HD 1366 и Full HD 1920)
  if (width < 1440) {
    return 'hd';      // 1366x768 и меньше
  } else {
    return 'fullhd';  // 1920x1080 и больше
  }
}

/**
 * Утилита для получения масштабного коэффициента
 * относительно Full HD (1920px = 1.0)
 *
 * @example
 * ```tsx
 * const { width } = useResponsive();
 * const scale = getScaleFactor(width);
 * const buttonSize = 120 * scale; // 120px на Full HD, ~85px на HD
 * ```
 */
export function getScaleFactor(width: number): number {
  // HD (1366) → 0.71, Full HD (1920) → 1.0
  const scale = width / BREAKPOINTS.fhd;
  return Math.max(0.7, Math.min(scale, 1.0)); // Ограничиваем 0.7-1.0
}
