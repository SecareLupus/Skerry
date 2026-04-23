"use client";

import { useEffect, useState, useRef, RefObject } from "react";

interface UseIntersectionObserverProps {
  threshold?: number;
  rootMargin?: string;
  enabled?: boolean;
}

export function useIntersectionObserver<T extends HTMLElement>(
  options: UseIntersectionObserverProps = {}
): [RefObject<T>, boolean] {
  const { threshold = 0, rootMargin = "500px", enabled = true } = options;
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!enabled || !ref.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        // If intersectionRatio is > 0 or isIntersecting is true
        const visible = (entry?.isIntersecting || (entry?.intersectionRatio ?? 0) > 0);
        setIsVisible(visible);
      },
      { 
        threshold: [0, 0.1], // Multiple thresholds to catch edge cases
        rootMargin 
      }
    );

    observer.observe(ref.current);

    return () => {
      observer.disconnect();
    };
  }, [threshold, rootMargin, enabled]);

  return [ref, isVisible];
}
