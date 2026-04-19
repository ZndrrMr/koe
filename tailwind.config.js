/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: '#DC2626',
        bg: {
          DEFAULT: '#FAFAF7',
          dark: '#0E0E10',
        },
        surface: {
          DEFAULT: '#FFFFFF',
          dark: '#1A1A1D',
        },
        fg: {
          DEFAULT: '#0E0E10',
          dark: '#F5F5F0',
        },
        muted: '#737373',
        accent: '#3B82F6',
        success: '#10B981',
        warning: '#F59E0B',
        danger: '#FF5A5F',
        pitch: {
          atamadaka: '#FF5A5F',
          heiban: '#3B82F6',
          nakadaka: '#F59E0B',
          odaka: '#EC4899',
        },
      },
      fontFamily: {
        sans: ['Inter_400Regular', 'system-ui'],
        ui: ['Inter_500Medium', 'system-ui'],
        jp: ['NotoSansJP_400Regular', 'system-ui'],
        jpBold: ['NotoSansJP_700Bold', 'system-ui'],
      },
      fontSize: {
        jp: ['22px', { lineHeight: '34px' }],
        jpLg: ['28px', { lineHeight: '40px' }],
      },
    },
  },
  plugins: [],
};
