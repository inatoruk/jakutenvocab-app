"use client";

import { RefObject, useEffect, useLayoutEffect, useRef } from "react";
import {
    animate,
    AnimationPlaybackControls,
    motion,
    useMotionValue,
    useReducedMotion,
    useTransform,
} from "framer-motion";

// 進行方向側の端（先端）は硬く速いバネで先に動き、
// 反対側の端（後端）は柔らかいバネで遅れてついてくる → 途中で伸びて「ムニョン」と収まる
const LEADING_SPRING = { type: "spring", stiffness: 520, damping: 42 } as const;
const TRAILING_SPRING = { type: "spring", stiffness: 240, damping: 22 } as const;

// 画面の分岐でトグルが再マウントされても前の位置から動けるよう、id ごとに最後の位置を覚えておく
const lastPositions = new Map<string, { left: number; right: number }>();

type Props = {
    id: string;
    containerRef: RefObject<HTMLElement | null>;
    itemRefs: RefObject<(HTMLElement | null)[]>;
    activeIndex: number;
    className?: string;
};

export default function JellyTabIndicator({ id, containerRef, itemRefs, activeIndex, className = "" }: Props) {
    const left = useMotionValue(0);
    const right = useMotionValue(0);
    const top = useMotionValue(0);
    const height = useMotionValue(0);
    const width = useTransform(() => Math.max(right.get() - left.get(), 0));
    const opacity = useMotionValue(0);
    const reduceMotion = useReducedMotion();
    const initialized = useRef(false);
    const controls = useRef<AnimationPlaybackControls[]>([]);
    const activeIndexRef = useRef(activeIndex);

    const measure = () => {
        const container = containerRef.current;
        const item = itemRefs.current[activeIndexRef.current];
        if (!container || !item) return null;
        const c = container.getBoundingClientRect();
        const r = item.getBoundingClientRect();
        if (c.width === 0 || r.width === 0) return null;
        const originX = c.left + container.clientLeft;
        const originY = c.top + container.clientTop;
        return {
            left: r.left - originX,
            right: r.right - originX,
            top: r.top - originY,
            height: r.height,
        };
    };

    const stop = () => {
        controls.current.forEach((c) => c.stop());
        controls.current = [];
    };

    const jump = () => {
        const m = measure();
        if (!m) return;
        stop();
        left.set(m.left);
        right.set(m.right);
        top.set(m.top);
        height.set(m.height);
        opacity.set(1);
        initialized.current = true;
    };

    useLayoutEffect(() => {
        activeIndexRef.current = activeIndex;
        const previous = lastPositions.get(id);
        if (reduceMotion || (!initialized.current && !previous)) {
            jump();
            return;
        }
        const m = measure();
        if (!m) return;
        stop();
        if (!initialized.current && previous) {
            left.set(previous.left);
            right.set(previous.right);
            opacity.set(1);
            initialized.current = true;
        }
        const movingRight = m.left > left.get();
        top.set(m.top);
        height.set(m.height);
        controls.current = [
            animate(left, m.left, movingRight ? TRAILING_SPRING : LEADING_SPRING),
            animate(right, m.right, movingRight ? LEADING_SPRING : TRAILING_SPRING),
        ];
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeIndex]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        // サイズ変更時はアニメーションせず即座に合わせる
        let first = true;
        const observer = new ResizeObserver(() => {
            // 初回の通知はマウント直後のもの（アニメーション中なので無視）
            if (first) {
                first = false;
                if (initialized.current) return;
            }
            jump();
        });
        observer.observe(container);
        return () => {
            observer.disconnect();
            stop();
            if (initialized.current) {
                lastPositions.set(id, { left: left.get(), right: right.get() });
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <motion.div
            aria-hidden
            className={`absolute left-0 pointer-events-none ${className}`}
            style={{ x: left, width, top, height, opacity }}
        />
    );
}
