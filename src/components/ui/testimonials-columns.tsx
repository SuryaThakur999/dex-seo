'use client';

import React from 'react';
import { motion, useReducedMotion } from 'motion/react';

export interface Testimonial {
  text: string;
  name: string;
  role: string;
}

export const TestimonialsColumn = (props: {
  className?: string;
  testimonials: Testimonial[];
  duration?: number;
}) => {
  const reduce = useReducedMotion();

  return (
    <div className={props.className}>
      <motion.div
        animate={reduce ? undefined : { translateY: '-50%' }}
        transition={{
          duration: props.duration || 10,
          repeat: Infinity,
          ease: 'linear',
          repeatType: 'loop',
        }}
        className="flex flex-col gap-4"
      >
        {[
          ...new Array(2).fill(0).map((_, index) => (
            <React.Fragment key={index}>
              {props.testimonials.map(({ text, name, role }, i) => (
                <div
                  className="w-full max-w-xs shrink-0 rounded-2xl border border-[#232329] bg-[#131318] p-6"
                  key={i}
                >
                  <p className="text-[0.9375rem] leading-relaxed text-[#c4c4cc]">{text}</p>
                  <div className="mt-5 flex flex-col gap-0.5 border-t border-[#232329] pt-4 text-[0.8125rem]">
                    <span className="font-medium tracking-tight text-[#f4f4f6]">{name}</span>
                    <span className="text-[#9a9aa5]">{role}</span>
                  </div>
                </div>
              ))}
            </React.Fragment>
          )),
        ]}
      </motion.div>
    </div>
  );
};
