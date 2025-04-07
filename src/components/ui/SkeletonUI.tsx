import { memo } from 'react';

// Skeleton UI component that mirrors the home page layout
export const SkeletonUI = memo(function SkeletonUI() {
  return (
    <div className="px-4 py-8 space-y-8 max-w-7xl mx-auto animate-pulse">
      {/* Welcome Section Skeleton */}
      <div className="bg-gradient-to-r from-blue-600/40 to-indigo-600/40 rounded-2xl p-6 sm:p-8">
        <div className="h-8 w-3/4 bg-white/20 rounded-md mb-2"></div>
        <div className="h-5 w-1/3 bg-white/20 rounded-md"></div>
      </div>

      {/* Task Stats Skeleton */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((item) => (
          <div key={item} className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-gray-200 dark:bg-gray-700 rounded-lg">
                <div className="w-5 h-5 bg-gray-300 dark:bg-gray-600 rounded"></div>
              </div>
              <div className="h-6 w-8 bg-gray-200 dark:bg-gray-700 rounded"></div>
            </div>
            <div className="h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded"></div>
          </div>
        ))}
      </div>

      {/* Categories Skeleton */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div className="h-6 w-32 bg-gray-200 dark:bg-gray-700 rounded"></div>
          <div className="h-6 w-20 bg-gray-200 dark:bg-gray-700 rounded-full"></div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[1, 2, 3, 4, 5, 6].map((item) => (
            <div 
              key={item} 
              className="flex items-center gap-2 p-3 rounded-xl bg-white dark:bg-gray-800"
            >
              <div className="p-2 bg-gray-200 dark:bg-gray-700 rounded-lg">
                <div className="w-5 h-5 bg-gray-300 dark:bg-gray-600 rounded"></div>
              </div>
              <div className="flex-1">
                <div className="h-4 w-20 bg-gray-200 dark:bg-gray-700 rounded mb-1"></div>
                <div className="h-3 w-12 bg-gray-200 dark:bg-gray-700 rounded"></div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Task List Skeleton */}
      <div>
        <div className="flex items-center justify-between mb-6">
          <div className="h-6 w-40 bg-gray-200 dark:bg-gray-700 rounded"></div>
        </div>
        <div className="space-y-4">
          {[1, 2, 3, 4].map((item) => (
            <div 
              key={item} 
              className="bg-white dark:bg-gray-800 p-4 rounded-2xl md:rounded-lg border border-gray-100 dark:border-gray-700/50 shadow-sm"
            >
              <div className="hidden md:flex items-start justify-between mb-3.5 md:mb-2">
                <div className="h-5 w-24 bg-gray-200 dark:bg-gray-700 rounded-full"></div>
              </div>
              <div className="space-y-2.5 md:space-y-2">
                <div className="flex items-start justify-between md:block">
                  <div className="h-5 w-3/4 bg-gray-200 dark:bg-gray-700 rounded"></div>
                  <div className="md:hidden h-4 w-20 bg-gray-200 dark:bg-gray-700 rounded-full"></div>
                </div>
                <div className="space-y-1">
                  <div className="h-4 w-full bg-gray-200 dark:bg-gray-700 rounded"></div>
                  <div className="h-4 w-1/2 bg-gray-200 dark:bg-gray-700 rounded"></div>
                </div>
              </div>
              <div className="flex items-center justify-between mt-3">
                <div className="flex items-center gap-1">
                  <div className="h-4 w-4 bg-gray-200 dark:bg-gray-700 rounded"></div>
                  <div className="h-4 w-20 bg-gray-200 dark:bg-gray-700 rounded"></div>
                </div>
                <div className="h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded"></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}); 