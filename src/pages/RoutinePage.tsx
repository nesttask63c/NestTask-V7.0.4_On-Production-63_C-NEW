import { useState, useMemo, useEffect } from 'react';
import { useRoutines } from '../hooks/useRoutines';
import { useCourses } from '../hooks/useCourses';
import { useTeachers } from '../hooks/useTeachers';
import { useAuth } from '../hooks/useAuth';
import { useOfflineStatus } from '../hooks/useOfflineStatus';
import { format, addDays, startOfWeek } from 'date-fns';
import { 
  Calendar, 
  Clock, 
  MapPin, 
  Search, 
  ChevronLeft,
  ChevronRight,
  Users,
  BookOpen,
  GraduationCap,
  Building,
  User,
  Info,
  Code,
  ExternalLink,
  RefreshCw,
  Plus
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { TeacherDetailsModal } from './TeacherDetailsModal';
import type { Teacher } from '../types/teacher';
import { getInitials } from '../utils/stringUtils';

export function RoutinePage() {
  const { routines, loading, loadRoutines } = useRoutines();
  const { courses } = useCourses();
  const { teachers } = useTeachers();
  const { user } = useAuth();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTeacher, setSelectedTeacher] = useState<Teacher | null>(null);
  const [enrichedSlots, setEnrichedSlots] = useState<any[]>([]);
  const [showMobileSearch, setShowMobileSearch] = useState(false);
  const [selectedRoutineId, setSelectedRoutineId] = useState<string>('');
  const [refreshing, setRefreshing] = useState(false);
  const isOffline = useOfflineStatus();

  const isAdmin = user?.role === 'admin';

  // Force load fresh data when component mounts or when page is refreshed
  useEffect(() => {
    if (!isOffline) {
      loadFreshRoutineData();
    }
  }, []);

  // Function to load fresh routine data
  const loadFreshRoutineData = async () => {
    setRefreshing(true);
    try {
      console.log('Loading fresh routine data on page load/refresh');
      // Call loadRoutines but don't rely on its return value since it returns void
      await loadRoutines(true);
      
      // Instead, check if we have data after loading
      const hasData = routines.length > 0 && routines.some(r => r.slots && r.slots.length > 0);
      
      // If we don't have data but have existing enriched slots, keep using them
      if (!hasData && enrichedSlots.length > 0) {
        console.log('Load did not provide routine data but using existing enriched slots');
      }
      
      return hasData || enrichedSlots.length > 0;
    } catch (err) {
      console.error('Error refreshing routine data:', err);
      return false;
    } finally {
      setRefreshing(false);
    }
  };

  const currentRoutine = useMemo(() => {
    if (selectedRoutineId) {
      return routines.find(r => r.id === selectedRoutineId);
    }
    return routines.find(r => r.isActive) || routines[0];
  }, [routines, selectedRoutineId]);

  useEffect(() => {
    if (currentRoutine?.id && !selectedRoutineId) {
      setSelectedRoutineId(currentRoutine.id);
    }
  }, [currentRoutine, selectedRoutineId]);

  const handleRoutineChange = (routineId: string) => {
    if (routineId === 'create-new') {
      window.location.href = '/#admin?tab=routine';
    } else {
      setSelectedRoutineId(routineId);
    }
  };

  const weekDays = useMemo(() => {
    const start = startOfWeek(selectedDate, { weekStartsOn: 6 });
    return Array.from({ length: 6 }, (_, i) => {
      const date = addDays(start, i);
      return {
        date,
        dayNum: format(date, 'd'),
        dayName: format(date, 'EEE'),
        isSelected: format(date, 'EEEE') === format(selectedDate, 'EEEE')
      };
    });
  }, [selectedDate]);

  useEffect(() => {
    if (!currentRoutine?.slots) {
      setEnrichedSlots([]);
      return;
    }

    console.log(`Processing ${currentRoutine.slots.length} slots for routine ${currentRoutine.id}`);
    console.log(`Offline status: ${isOffline ? 'Offline' : 'Online'}`);
    console.log(`Teachers available: ${teachers.length}, Courses available: ${courses.length}`);

    const enriched = currentRoutine.slots.map(slot => {
      // Don't process slots marked for deletion in offline mode
      if (slot._isOfflineDeleted) {
        return null;
      }
      
      // Find matching course and teacher objects
      const course = slot.courseId ? courses.find(c => c.id === slot.courseId) : undefined;
      const teacher = slot.teacherId ? teachers.find(t => t.id === slot.teacherId) : undefined;
      
      // Prioritize using slot's own courseName/teacherName if available
      // These properties are particularly important in offline mode
      const courseName = slot.courseName || (course ? course.name : 'Unknown Course');
      const courseCode = course ? course.code : 'N/A';
      const teacherName = slot.teacherName || (teacher ? teacher.name : 'Unknown Teacher');
      const roomNumber = slot.roomNumber || 'TBA';
      const dayOfWeek = slot.dayOfWeek || 'N/A';
      const startTime = slot.startTime || 'N/A';
      const endTime = slot.endTime || 'N/A';
            
      return {
        ...slot,
        course,
        teacher,
        courseName,
        courseCode,
        teacherName,
        roomNumber,
        dayOfWeek,
        startTime,
        endTime
      };
    }).filter(Boolean); // Remove null entries (deleted slots)

    console.log(`Prepared ${enriched.length} enriched slots for display`);
    setEnrichedSlots(enriched);
  }, [currentRoutine, courses, teachers, isOffline]);

  const filteredSlots = useMemo(() => {
    return enrichedSlots.filter(slot => {
      // Basic validation for required fields
      if (!slot.dayOfWeek || !slot.startTime || !slot.endTime) {
        console.warn('Skipping invalid slot:', slot);
        return false;
      }

      const matchesSearch = searchTerm === '' || 
        (slot.courseName && slot.courseName.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (slot.course?.code && slot.course.code.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (slot.roomNumber && slot.roomNumber.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (slot.teacherName && slot.teacherName.toLowerCase().includes(searchTerm.toLowerCase()));
      
      const matchesDay = format(selectedDate, 'EEEE').toLowerCase() === slot.dayOfWeek.toLowerCase();
      
      return matchesSearch && matchesDay;
    });
  }, [enrichedSlots, searchTerm, selectedDate]);

  // Sort slots by start time
  const sortedSlots = useMemo(() => {
    return [...filteredSlots].sort((a, b) => {
      if (!a.startTime || !b.startTime) return 0;
      return a.startTime.localeCompare(b.startTime);
    });
  }, [filteredSlots]);

  // Skeleton UI component for better perceived performance
  const RoutineSkeleton = () => (
    <div className="space-y-3 animate-pulse">
      {/* Day selector skeleton */}
      <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 sm:p-4 shadow-sm mb-4">
        <div className="flex justify-between">
          <div>
            <div className="h-6 w-40 bg-gray-200 dark:bg-gray-700 rounded mb-2"></div>
            <div className="h-4 w-32 bg-gray-200 dark:bg-gray-700 rounded"></div>
          </div>
          <div className="flex space-x-2">
            <div className="h-10 w-32 bg-gray-200 dark:bg-gray-700 rounded"></div>
            <div className="h-10 w-64 bg-gray-200 dark:bg-gray-700 rounded"></div>
          </div>
        </div>
      </div>
      
      {/* Day picker skeleton */}
      <div className="mb-6">
        <div className="h-5 w-40 bg-gray-200 dark:bg-gray-700 rounded mb-3 mx-auto"></div>
        <div className="grid grid-cols-6 gap-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-20 bg-gray-200 dark:bg-gray-700 rounded-xl"></div>
          ))}
        </div>
      </div>
      
      {/* Class slots skeleton */}
      {[...Array(3)].map((_, i) => (
        <div key={i} className="bg-white dark:bg-gray-800 rounded-lg sm:rounded-xl overflow-hidden shadow-sm border border-gray-100 dark:border-gray-700/50 h-32">
          <div className="flex flex-row h-full">
            <div className="w-[85px] sm:w-[120px] md:w-[180px] bg-gray-50 dark:bg-gray-800/40 flex flex-col justify-between items-center py-4 px-2 border-r border-gray-100 dark:border-gray-700/50">
              <div className="h-6 w-16 bg-gray-200 dark:bg-gray-700 rounded"></div>
              <div className="h-6 w-16 bg-gray-200 dark:bg-gray-700 rounded"></div>
            </div>
            <div className="flex-1 p-4">
              <div className="h-6 w-3/4 bg-gray-200 dark:bg-gray-700 rounded mb-4"></div>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <div className="h-4 w-16 bg-gray-200 dark:bg-gray-700 rounded"></div>
                  <div className="h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded"></div>
                </div>
                <div className="flex justify-between">
                  <div className="h-4 w-16 bg-gray-200 dark:bg-gray-700 rounded"></div>
                  <div className="h-4 w-16 bg-gray-200 dark:bg-gray-700 rounded"></div>
                </div>
                <div className="flex justify-between">
                  <div className="h-4 w-16 bg-gray-200 dark:bg-gray-700 rounded"></div>
                  <div className="h-4 w-12 bg-gray-200 dark:bg-gray-700 rounded"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  // Preserve the current slots when component remounts
  useEffect(() => {
    // Data persistence for page refreshes
    const handleBeforeUnload = () => {
      if (currentRoutine?.id && enrichedSlots.length > 0) {
        try {
          // Save the current view state to sessionStorage
          sessionStorage.setItem('last_routine_view', JSON.stringify({
            routineId: currentRoutine.id,
            slots: enrichedSlots,
            selectedDate: selectedDate.toISOString(),
            searchTerm
          }));
          console.log('Preserved routine view state before unload');
        } catch (err) {
          console.error('Failed to save routine state:', err);
        }
      }
    };

    // Attach the handler
    window.addEventListener('beforeunload', handleBeforeUnload);

    // Try to restore from session storage on remount
    try {
      const savedState = sessionStorage.getItem('last_routine_view');
      if (savedState) {
        const parsedState = JSON.parse(savedState);
        
        if (parsedState.slots && parsedState.slots.length > 0) {
          console.log('Restoring routine view state from session');
          setEnrichedSlots(parsedState.slots);
        }
        
        if (parsedState.selectedDate) {
          setSelectedDate(new Date(parsedState.selectedDate));
        }
        
        if (parsedState.searchTerm) {
          setSearchTerm(parsedState.searchTerm);
        }
        
        if (parsedState.routineId && !selectedRoutineId) {
          setSelectedRoutineId(parsedState.routineId);
        }
      }
    } catch (err) {
      console.error('Failed to restore routine state:', err);
    }

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [currentRoutine, enrichedSlots, selectedDate, searchTerm, selectedRoutineId]);

  if (loading || refreshing) {
    return (
      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-8">
        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg mb-4 sm:mb-6 p-3 sm:p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center">
                <Calendar className="w-6 h-6 lg:w-7 lg:h-7 text-blue-400 opacity-70 mr-2" />
                <div className="h-8 w-40 bg-gray-200 dark:bg-gray-700 rounded"></div>
              </div>
              <div className="h-4 w-32 bg-gray-200 dark:bg-gray-700 rounded mt-2"></div>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-10 w-10 rounded-full bg-gray-200 dark:bg-gray-700 animate-spin"></div>
            </div>
          </div>
        </div>
        
        <RoutineSkeleton />
        
        <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 bg-white dark:bg-gray-800 px-4 py-2 rounded-full shadow-lg text-sm text-gray-600 dark:text-gray-300">
          <div className="flex items-center">
            <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full mr-2"></div>
            {refreshing ? 'Refreshing routine data...' : 'Loading your class schedule...'}
          </div>
        </div>
      </div>
    );
  }

  if (!currentRoutine) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen text-center px-4">
        <BookOpen className="w-16 h-16 text-gray-400 dark:text-gray-500 mb-4" />
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">No Routine Available</h2>
        <p className="text-gray-500 dark:text-gray-400">
          {isOffline ? 
            "You're currently offline. No cached routines were found." : 
            "There are no active routines at the moment."}
        </p>
        {isAdmin && (
          <button 
            onClick={() => window.location.href = '/#admin?tab=routine'}
            className="mt-4 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg"
          >
            Create Routine
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-8">
      {isOffline && (
        <div className="bg-yellow-50 border-yellow-200 border rounded-lg p-4 mb-4">
          <div className="flex items-center">
            <Info className="h-5 w-5 text-yellow-500 mr-2" />
            <p className="text-sm text-yellow-700">
              You are currently offline. Displaying cached routine data.
            </p>
          </div>
        </div>
      )}
      
      <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg mb-4 sm:mb-6 p-3 sm:p-4 shadow-sm">
        <div className="flex flex-col space-y-3 md:hidden">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600 dark:text-blue-400" />
              <h1 className="text-base sm:text-lg font-bold text-gray-900 dark:text-white">Class Routine</h1>
            </div>
            
            <div className="flex items-center gap-2">
              {!isOffline && (
                <button 
                  onClick={loadFreshRoutineData}
                  disabled={refreshing}
                  className="p-2 bg-white dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600 disabled:opacity-50"
                  aria-label="Refresh data"
                  title="Refresh routine data"
                >
                  <RefreshCw className={`w-5 h-5 text-gray-500 dark:text-gray-400 ${refreshing ? 'animate-spin' : ''}`} />
                </button>
              )}
              
              <button 
                onClick={() => setShowMobileSearch(!showMobileSearch)}
                className="p-2 bg-white dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600"
                aria-label={showMobileSearch ? "Hide search" : "Show search"}
              >
                <Search className="w-5 h-5 text-gray-500 dark:text-gray-400" />
              </button>
            </div>
          </div>
          
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {currentRoutine.name} - {currentRoutine.semester}
          </p>

          {routines.length > 0 && (
            <div className="relative mt-1">
              <select
                value={selectedRoutineId}
                onChange={(e) => handleRoutineChange(e.target.value)}
                className="w-full pl-9 pr-8 py-2 border dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white text-sm appearance-none space-y-6 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors duration-200 cursor-pointer"
              >
                {routines.map(routine => (
                  <option key={routine.id} value={routine.id}>
                    {routine.name} - {routine.semester} {routine.isActive ? "(Active)" : ""}
                  </option>
                ))}
                {isAdmin && (
                  <option value="create-new" className="font-medium text-blue-600 dark:text-blue-400">
                    + Create New Routine
                  </option>
                )}
              </select>
              <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <ChevronRight className="absolute right-2 top-1/2 transform -translate-y-1/2 rotate-90 text-gray-400 w-4 h-4" />
            </div>
          )}
          
          <AnimatePresence>
            {showMobileSearch && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="relative mt-2">
                  <input
                    type="text"
                    placeholder="Search courses, teachers, rooms..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white text-sm"
                  />
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="hidden md:flex md:flex-row md:flex-wrap md:items-center md:justify-between gap-y-4">
          <div>
            <h1 className="text-xl lg:text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Calendar className="w-6 h-6 lg:w-7 lg:h-7 text-blue-600 dark:text-blue-400" />
              Class Routine
            </h1>
            <p className="text-sm lg:text-base text-gray-500 dark:text-gray-400 mt-1">
              {currentRoutine.name} - {currentRoutine.semester}
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {routines.length > 0 && (
              <div className="relative">
                <select
                  value={selectedRoutineId}
                  onChange={(e) => handleRoutineChange(e.target.value)}
                  className="pl-10 pr-4 py-2 border dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white appearance-none space-y-6 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors duration-200 cursor-pointer"
                >
                  {routines.map(routine => (
                    <option key={routine.id} value={routine.id}>
                      {routine.name} - {routine.semester} {routine.isActive ? "(Active)" : ""}
                    </option>
                  ))}
                  {isAdmin && (
                    <option value="create-new" className="font-medium text-blue-600 dark:text-blue-400">
                      + Create New Routine
                    </option>
                  )}
                </select>
                <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                <ChevronRight className="absolute right-3 top-1/2 transform -translate-y-1/2 rotate-90 text-gray-400 w-4 h-4" />
              </div>
            )}

            {!isOffline && (
              <button 
                onClick={loadFreshRoutineData}
                disabled={refreshing}
                className="p-2 bg-white dark:bg-gray-700 rounded-xl border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors disabled:opacity-50"
                aria-label="Refresh data"
                title="Refresh routine data"
              >
                <RefreshCw className={`w-5 h-5 text-gray-500 dark:text-gray-400 ${refreshing ? 'animate-spin' : ''}`} />
              </button>
            )}

            <div className="relative w-full sm:w-auto sm:flex-grow">
              <input
                type="text"
                placeholder="Search courses, teachers, rooms..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
              />
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            </div>
          </div>
        </div>
      </div>

      <div className="mb-4 sm:mb-6">
        <div className="flex items-center justify-between mb-2 sm:mb-4">
          <button
            onClick={() => {
              const prevDay = addDays(selectedDate, -1);
              setSelectedDate(prevDay);
            }}
            className="p-1.5 sm:p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Previous day"
          >
            <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>

          <h2 className="text-sm sm:text-base lg:text-lg font-semibold text-gray-900 dark:text-white">
            {format(selectedDate, 'EEEE, MMMM d')}
          </h2>

          <button
            onClick={() => {
              const nextDay = addDays(selectedDate, 1);
              setSelectedDate(nextDay);
            }}
            className="p-1.5 sm:p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Next day"
          >
            <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
        </div>

        <div className="grid grid-cols-6 gap-1 sm:gap-2">
          {weekDays.map((day) => (
            <button
              key={day.dayName}
              onClick={() => setSelectedDate(day.date)}
              className={`
                flex flex-col items-center py-2 px-0.5 xs:py-2.5 xs:px-1 sm:p-3 md:p-4 rounded-xl transition-all duration-200 touch-manipulation focus:outline-none focus:ring-2 focus:ring-blue-500
                ${day.isSelected
                  ? 'bg-blue-600 text-white shadow-md scale-[1.02] focus:ring-blue-300'
                  : 'bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700'
                }
              `}
            >
              <span className={`
                text-[0.65rem] xs:text-xs sm:text-sm font-medium mb-0.5 sm:mb-1
                ${day.isSelected
                  ? 'text-blue-100'
                  : 'text-gray-500 dark:text-gray-400'
                }
              `}>
                {day.dayName}
              </span>
              <span className={`
                text-base xs:text-lg sm:text-xl md:text-2xl font-bold
                ${day.isSelected
                  ? 'text-white'
                  : 'text-gray-900 dark:text-white'
                }
              `}>
                {day.dayNum}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2 sm:space-y-3">
        {sortedSlots.length === 0 ? (
          <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-xl shadow-sm">
            <Calendar className="w-12 h-12 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400 font-medium">No classes scheduled for {format(selectedDate, 'EEEE')}</p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
              Try selecting a different day or check back later
            </p>
          </div>
        ) : (
          sortedSlots.map((slot) => (
            <motion.div
              key={slot.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white dark:bg-gray-800 rounded-lg sm:rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-all duration-300 border border-gray-100 dark:border-gray-700/50"
            >
              <div className="flex flex-row items-stretch h-full">
                <div className="w-[85px] sm:w-[120px] md:w-[180px] bg-gray-50 dark:bg-gray-800/40 flex flex-col justify-between items-center py-4 sm:py-6 md:py-8 px-2 sm:px-3 md:px-4 border-r border-gray-100 dark:border-gray-700/50">
                  <div className="flex flex-col items-center">
                    <div className="text-lg sm:text-xl md:text-2xl lg:text-3xl font-medium text-gray-700 dark:text-gray-300">
                      {format(new Date(`2000-01-01T${slot.startTime}`), 'h:mm')}
                    </div>
                  </div>
                  
                  <div className="flex flex-col items-center justify-center py-3 sm:py-4 md:py-5 w-full space-y-2 sm:space-y-3">
                    <div className="w-12 sm:w-16 md:w-20 border-t border-gray-200 dark:border-gray-600"></div>
                    <div className="w-10 sm:w-14 md:w-16 border-t border-gray-200 dark:border-gray-600"></div>
                    <div className="w-8 sm:w-12 md:w-14 border-t border-gray-200 dark:border-gray-600"></div>
                    <div className="w-10 sm:w-14 md:w-16 border-t border-gray-200 dark:border-gray-600"></div>
                    <div className="w-12 sm:w-16 md:w-20 border-t border-gray-200 dark:border-gray-600"></div>
                  </div>
                  
                  <div className="flex flex-col items-center">
                    <div className="text-lg sm:text-xl md:text-2xl lg:text-3xl font-medium text-gray-700 dark:text-gray-300">
                      {format(new Date(`2000-01-01T${slot.endTime}`), 'h:mm')}
                    </div>
                  </div>
                </div>

                <div className="flex-1 p-2.5 xs:p-3 sm:p-4 md:p-6 lg:p-8">
                  <h3 className="text-sm sm:text-lg md:text-xl lg:text-2xl font-medium text-slate-600 dark:text-slate-300 mb-2 sm:mb-3 md:mb-4 lg:mb-6 line-clamp-2">
                    {slot.courseName || 'No Course Name'}
                  </h3>
                  
                  <div className="space-y-1.5 sm:space-y-2 md:space-y-3 lg:space-y-4">
                    <div className="flex justify-between items-center">
                      <span className="text-[11px] xs:text-xs sm:text-sm md:text-base lg:text-lg text-gray-500 dark:text-gray-400">Course</span>
                      <span className="text-[11px] xs:text-xs sm:text-sm md:text-base lg:text-lg font-medium text-gray-800 dark:text-gray-200">{slot.courseCode || 'N/A'}</span>
                    </div>
                    
                    <div className="flex justify-between items-center">
                      <span className="text-[11px] xs:text-xs sm:text-sm md:text-base lg:text-lg text-gray-500 dark:text-gray-400">Section</span>
                      <span className="text-[11px] xs:text-xs sm:text-sm md:text-base lg:text-lg font-medium text-gray-800 dark:text-gray-200">{slot.section || 'N/A'}</span>
                    </div>
                    
                    <div className="flex justify-between items-center">
                      <span className="text-[11px] xs:text-xs sm:text-sm md:text-base lg:text-lg text-gray-500 dark:text-gray-400">Teacher</span>
                      <span className="text-[11px] xs:text-xs sm:text-sm md:text-base lg:text-lg font-medium">
                        {slot.teacherId ? (
                          <button
                            onClick={() => {
                              const fullTeacher = teachers.find(t => t.id === slot.teacherId);
                              setSelectedTeacher(fullTeacher || null);
                            }}
                            className="text-indigo-500 dark:text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 rounded-sm"
                            title={slot.teacherName || 'Unknown Teacher'}
                          >
                            {getInitials(slot.teacherName || 'Unknown')}
                          </button>
                        ) : (
                          'N/A'
                        )}
                      </span>
                    </div>
                    
                    <div className="flex justify-between items-center">
                      <span className="text-[11px] xs:text-xs sm:text-sm md:text-base lg:text-lg text-gray-500 dark:text-gray-400">Room</span>
                      <span className="text-[11px] xs:text-xs sm:text-sm md:text-base lg:text-lg font-medium text-gray-800 dark:text-gray-200">{slot.roomNumber || 'N/A'}</span>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          ))
        )}
      </div>

      {selectedTeacher && (
        <TeacherDetailsModal
          teacher={selectedTeacher}
          onClose={() => setSelectedTeacher(null)}
        />
      )}
    </div>
  );
}