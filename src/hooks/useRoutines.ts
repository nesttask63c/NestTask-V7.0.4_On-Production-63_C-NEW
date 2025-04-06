import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { 
  fetchRoutines,
  createRoutine as createRoutineService,
  updateRoutine as updateRoutineService,
  deleteRoutine as deleteRoutineService,
  addRoutineSlot as addRoutineSlotService,
  updateRoutineSlot as updateRoutineSlotService,
  deleteRoutineSlot as deleteRoutineSlotService,
  activateRoutine as activateRoutineService,
  deactivateRoutine as deactivateRoutineService,
  bulkImportRoutineSlots as bulkImportRoutineSlotsService,
  exportRoutineWithSlots as exportRoutineWithSlotsService,
  getAllSemesters as getAllSemestersService,
  getRoutinesBySemester as getRoutinesBySemesterService
} from '../services/routine.service';
import type { Routine, RoutineSlot } from '../types/routine';
import { useOfflineStatus } from './useOfflineStatus';
import { saveToIndexedDB, getAllFromIndexedDB, STORES, getByIdFromIndexedDB, clearIndexedDBStore } from '../utils/offlineStorage';

// Define timestamp for cached data
const CACHE_TIMESTAMP_KEY = 'routines_last_fetched';

// Add a way to track which routines have been fully loaded with slots
const LOADED_ROUTINES_KEY = 'fully_loaded_routines';

// Add this new function to help diagnose routine service issues
const runServiceDiagnostics = async () => {
  console.log('Running routine service diagnostics...');
  const diagnosticResults = {
    supabaseConnection: false,
    routineTableAccess: false,
    routineSlotsTableAccess: false,
    teachersTableAccess: false,
    coursesTableAccess: false,
    issues: [] as string[]
  };
  
  try {
    // Test basic connection to Supabase
    const { data: connectionTest, error: connectionError } = await supabase.from('_health').select('*').limit(1);
    diagnosticResults.supabaseConnection = !connectionError;
    
    if (connectionError) {
      diagnosticResults.issues.push(`Connection to Supabase failed: ${connectionError.message}`);
    }
    
    // Test access to routines table
    const { data: routinesTest, error: routinesError } = await supabase.from('routines').select('count').limit(1);
    diagnosticResults.routineTableAccess = !routinesError;
    
    if (routinesError) {
      diagnosticResults.issues.push(`Access to routines table failed: ${routinesError.message}`);
    }
    
    // Test access to routine_slots table
    const { data: slotsTest, error: slotsError } = await supabase.from('routine_slots').select('count').limit(1);
    diagnosticResults.routineSlotsTableAccess = !slotsError;
    
    if (slotsError) {
      diagnosticResults.issues.push(`Access to routine_slots table failed: ${slotsError.message}`);
    }
    
    // Test access to teachers table
    const { data: teachersTest, error: teachersError } = await supabase.from('teachers').select('count').limit(1);
    diagnosticResults.teachersTableAccess = !teachersError;
    
    if (teachersError) {
      diagnosticResults.issues.push(`Access to teachers table failed: ${teachersError.message}`);
    }
    
    // Test access to courses table
    const { data: coursesTest, error: coursesError } = await supabase.from('courses').select('count').limit(1);
    diagnosticResults.coursesTableAccess = !coursesError;
    
    if (coursesError) {
      diagnosticResults.issues.push(`Access to courses table failed: ${coursesError.message}`);
    }
    
    console.log('Routine service diagnostics results:', diagnosticResults);
    return diagnosticResults;
  } catch (error: any) {
    console.error('Error running diagnostics:', error);
    diagnosticResults.issues.push(`Unexpected error during diagnostics: ${error.message}`);
    return diagnosticResults;
  }
};

export function useRoutines() {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncInProgress, setSyncInProgress] = useState(false);
  const [diagnosticState, setDiagnosticState] = useState<any>(null);
  const isOffline = useOfflineStatus();

  // Enhanced prefetch function to make initial load faster
  const prefetchRoutineData = useCallback(async () => {
    if (isOffline) return; // Don't prefetch when offline
    
    try {
      console.log('Aggressively prefetching routine data for faster access');
      
      // Get the active routine first for fastest critical path
      const { data: activeRoutines } = await supabase
        .from('routines')
        .select('id')
        .eq('is_active', true)
        .limit(1);
      
      if (activeRoutines && activeRoutines.length > 0) {
        const activeRoutineId = activeRoutines[0].id;
        
        // Prefetch active routine's slots for immediate display
        console.log('Prefetching slots for active routine', activeRoutineId);
        const { data: slots } = await supabase
          .from('routine_slots')
          .select('*')
          .eq('routine_id', activeRoutineId);
        
        // Get IDs for related data
        if (slots && slots.length > 0) {
          const courseIds = [...new Set(slots.map(s => s.course_id).filter(Boolean))];
          const teacherIds = [...new Set(slots.map(s => s.teacher_id).filter(Boolean))];
          
          // Prefetch all related data in parallel
          await Promise.all([
            supabase.from('courses').select('id,name,code').in('id', courseIds),
            supabase.from('teachers').select('id,name').in('id', teacherIds)
          ]);
        }
      }
      
      console.log('Critical path prefetch completed successfully');
    } catch (err) {
      console.error('Error prefetching routine data:', err);
      // Silent failure - this is just an optimization
    }
  }, [isOffline]);

  // Add a new function to verify if routine data is complete (has slots)
  const verifyRoutineDataCompleteness = useCallback(async () => {
    try {
      const storedRoutines = await getAllFromIndexedDB(STORES.ROUTINES);
      
      // Check if we have routines but they're missing slots
      if (storedRoutines && storedRoutines.length > 0) {
        // Find the active routine
        const activeRoutine = storedRoutines.find(r => r.isActive);
        
        if (activeRoutine) {
          // Check if slots are missing or empty
          const hasSlots = activeRoutine.slots && activeRoutine.slots.length > 0;
          console.log(`Active routine ${activeRoutine.id} has slots: ${hasSlots}`);
          
          if (!hasSlots) {
            // Slots are missing, explicitly fetch them
            console.log('Fetching missing slots for active routine');
            await refreshRoutineSlots(activeRoutine.id);
            return false; // Indicate data needed to be fixed
          }
        }
        
        return true; // Data is complete
      }
      
      return false; // No data found
    } catch (err) {
      console.error('Error verifying routine data completeness:', err);
      return false;
    }
  }, []);

  // Improved load routines function with parallel processing and faster rendering
  const loadRoutines = useCallback(async (forceRefresh = false, isAdminView = false) => {
    try {
      setLoading(true);
      setError(null);
      
      // When in admin view, always force a fresh fetch to ensure accurate data
      if (isAdminView) {
        forceRefresh = true;
        console.log('Admin view detected, bypassing cache and loading fresh routine data');
      }

      // If forceRefresh is true, invalidate the cache by removing the timestamp
      if (forceRefresh) {
        console.log('Force refresh requested, invalidating cache');
        localStorage.removeItem(CACHE_TIMESTAMP_KEY);
        localStorage.removeItem(LOADED_ROUTINES_KEY);
      }
      
      if (isOffline) {
        // When offline, get routines from IndexedDB
        console.log('Offline mode: Loading routines from IndexedDB');
        const offlineRoutines = await getAllFromIndexedDB(STORES.ROUTINES);
        
        if (offlineRoutines && offlineRoutines.length > 0) {
          console.log('Found offline routines:', offlineRoutines.length);
          // Check if the slots data is there
          const hasSlots = offlineRoutines.some(r => r.slots && r.slots.length > 0);
          console.log('Offline routines have slots:', hasSlots);
          setRoutines(offlineRoutines);
        } else {
          console.log('No offline routines found');
          setRoutines([]);
        }
      } else {
        // Check cache validity and only fetch if necessary
        const lastFetchedTimestamp = localStorage.getItem(CACHE_TIMESTAMP_KEY);
        const currentTime = Date.now();
        const cacheDurationMs = isAdminView ? 0 : 3 * 60 * 1000; // No cache for admin, 3 minutes for regular users (reduced from 5)
        const isCacheValid = !isAdminView && !forceRefresh && lastFetchedTimestamp && 
                            (currentTime - parseInt(lastFetchedTimestamp)) < cacheDurationMs;
        
        // Skip fetch if cache is valid and not forcing refresh
        if (isCacheValid && !forceRefresh) {
          console.log('Using cached routines data (valid for 3 minutes)');
          const cachedRoutines = await getAllFromIndexedDB(STORES.ROUTINES);
          if (cachedRoutines && cachedRoutines.length > 0) {
            // Check if slots data exists in the cache
            const hasSlots = cachedRoutines.some(r => r.slots && r.slots.length > 0);
            console.log('Cached routines have slots:', hasSlots);
            
            if (hasSlots) {
              setRoutines(cachedRoutines);
              // Start background refresh for next visit
              setTimeout(() => {
                console.log('Starting background refresh for future visits');
                fetchRoutines().then(freshData => {
                  if (freshData && freshData.length > 0) {
                    saveToIndexedDB(STORES.ROUTINES, freshData);
                    localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
                  }
                }).catch(err => console.warn('Background refresh error:', err));
              }, 500);
              setLoading(false);
              return;
            } else {
              console.log('Cached routines missing slot data, forcing refresh');
              // If slots are missing, force a refresh
              forceRefresh = true;
            }
          }
        }
        
        // Progressive loading approach - fetch basic data first, then fill in details
        try {
          // 1. First quickly load basic routine data without slots
          console.log('Starting progressive load - fetching basic routine data');
          const { data: basicRoutines } = await supabase
            .from('routines')
            .select('*')
            .order('created_at', { ascending: false });
            
          if (basicRoutines && basicRoutines.length > 0) {
            const mappedBasicRoutines: Routine[] = basicRoutines.map((r: any) => ({
              id: r.id,
              name: r.name,
              semester: r.semester,
              isActive: r.is_active,
              createdAt: r.created_at,
              slots: []
            }));
            
            // Before updating state, check if there's cached data with slots
            // This helps prevent flicker when loading from cache
            const existingRoutines = await getAllFromIndexedDB(STORES.ROUTINES);
            const hasExistingRoutines = existingRoutines && existingRoutines.length > 0;
            const hasSlots = hasExistingRoutines && existingRoutines.some(r => r.slots && r.slots.length > 0);
            
            if (hasExistingRoutines && hasSlots && !forceRefresh) {
              console.log('Using cached data with slots while loading from server');
              // Use the cached data first to avoid flickering
              setRoutines(existingRoutines);
            } else {
              // Immediately update state with basic data for faster rendering
              setRoutines(mappedBasicRoutines);
            }
            
            // Get active routine ID for prioritized slot loading
            const activeRoutine = mappedBasicRoutines.find(r => r.isActive);
            if (activeRoutine) {
              // 2. Prioritize loading slots for the active routine
              console.log('Loading slots for active routine first');
              const { data: activeSlots } = await supabase
                .from('routine_slots')
                .select('*')
                .eq('routine_id', activeRoutine.id);
              
              if (activeSlots && activeSlots.length > 0) {
                // Format the slots
                const formattedActiveSlots = activeSlots.map((slot: any) => ({
                  id: slot.id,
                  routineId: slot.routine_id,
                  dayOfWeek: slot.day_of_week,
                  startTime: slot.start_time,
                  endTime: slot.end_time,
                  roomNumber: slot.room_number || '',
                  section: slot.section || '',
                  courseId: slot.course_id || '',
                  teacherId: slot.teacher_id || '',
                  courseName: '',
                  courseCode: '',
                  teacherName: '',
                  createdAt: slot.created_at
                }));
                
                // Update the active routine with slots
                const updatedRoutines = [...mappedBasicRoutines];
                const activeIndex = updatedRoutines.findIndex(r => r.id === activeRoutine.id);
                if (activeIndex >= 0) {
                  updatedRoutines[activeIndex] = {
                    ...updatedRoutines[activeIndex],
                    slots: formattedActiveSlots
                  };
                  setRoutines(updatedRoutines);
                }
                
                // 3. Load related teacher and course data
                const courseIds = [...new Set(formattedActiveSlots.map(s => s.courseId).filter(Boolean))];
                const teacherIds = [...new Set(formattedActiveSlots.map(s => s.teacherId).filter(Boolean))];
                
                if (courseIds.length > 0 || teacherIds.length > 0) {
                  const [courseData, teacherData] = await Promise.all([
                    courseIds.length > 0 ? supabase.from('courses').select('id,name,code').in('id', courseIds) : { data: [] },
                    teacherIds.length > 0 ? supabase.from('teachers').select('id,name').in('id', teacherIds) : { data: [] }
                  ]);
                  
                  const courses = courseData.data || [];
                  const teachers = teacherData.data || [];
                  
                  // Create maps for faster lookup
                  const courseMap = new Map();
                  const teacherMap = new Map();
                  courses.forEach((c: any) => courseMap.set(c.id, { name: c.name, code: c.code }));
                  teachers.forEach((t: any) => teacherMap.set(t.id, t.name));
                  
                  // Enrich slots with course and teacher data
                  const enrichedSlots = formattedActiveSlots.map(slot => {
                    const courseInfo = courseMap.get(slot.courseId) || {};
                    return {
                      ...slot,
                      courseName: courseInfo.name || '',
                      courseCode: courseInfo.code || '',
                      teacherName: teacherMap.get(slot.teacherId) || ''
                    };
                  });
                  
                  // Update the active routine with enriched slots
                  const finalUpdatedRoutines = [...updatedRoutines];
                  const finalActiveIndex = finalUpdatedRoutines.findIndex(r => r.id === activeRoutine.id);
                  if (finalActiveIndex >= 0) {
                    finalUpdatedRoutines[finalActiveIndex] = {
                      ...finalUpdatedRoutines[finalActiveIndex],
                      slots: enrichedSlots
                    };
                    setRoutines(finalUpdatedRoutines);
                  }
                }
              } else {
                // No slots found from API - try to recover from cache
                const existingRoutines = await getAllFromIndexedDB(STORES.ROUTINES);
                const existingActive = existingRoutines?.find(r => r.id === activeRoutine.id);
                
                if (existingActive?.slots && existingActive.slots.length > 0) {
                  console.log('Using cached slots for active routine as API returned none');
                  const recoveredRoutines = [...mappedBasicRoutines];
                  const activeIndex = recoveredRoutines.findIndex(r => r.id === activeRoutine.id);
                  if (activeIndex >= 0) {
                    recoveredRoutines[activeIndex] = {
                      ...recoveredRoutines[activeIndex], 
                      slots: existingActive.slots
                    };
                    setRoutines(recoveredRoutines);
                  }
                }
              }
              
              // Store that we've fully loaded this routine
              const loadedRoutines = JSON.parse(localStorage.getItem(LOADED_ROUTINES_KEY) || '[]');
              if (!loadedRoutines.includes(activeRoutine.id)) {
                loadedRoutines.push(activeRoutine.id);
                localStorage.setItem(LOADED_ROUTINES_KEY, JSON.stringify(loadedRoutines));
              }
            }
            
            // 4. In the background, load slots for other routines
            Promise.all(
              mappedBasicRoutines
                .filter(r => !r.isActive)
                .map(async routine => {
                  try {
                    const { data: slots } = await supabase
                      .from('routine_slots')
                      .select('*')
                      .eq('routine_id', routine.id);
                      
                    if (slots && slots.length > 0) {
                      return {
                        routineId: routine.id,
                        slots: slots.map((slot: any) => ({
                          id: slot.id,
                          routineId: slot.routine_id,
                          dayOfWeek: slot.day_of_week,
                          startTime: slot.start_time,
                          endTime: slot.end_time,
                          roomNumber: slot.room_number || '',
                          section: slot.section || '',
                          courseId: slot.course_id || '',
                          teacherId: slot.teacher_id || '',
                          courseName: '',
                          courseCode: '',
                          teacherName: '',
                          createdAt: slot.created_at
                        }))
                      };
                    }
                    
                    // No slots from API - try to recover from cache
                    const existingRoutines = await getAllFromIndexedDB(STORES.ROUTINES);
                    const existingRoutine = existingRoutines?.find(r => r.id === routine.id);
                    
                    if (existingRoutine?.slots && existingRoutine.slots.length > 0) {
                      console.log(`Using cached slots for routine ${routine.id} as API returned none`);
                      return {
                        routineId: routine.id,
                        slots: existingRoutine.slots
                      };
                    }
                    
                    return { routineId: routine.id, slots: [] };
                  } catch (err) {
                    console.error(`Error loading slots for routine ${routine.id}:`, err);
                    return { routineId: routine.id, slots: [] };
                  }
                })
            ).then(results => {
              // Update each routine with its slots
              const fullRoutines = [...mappedBasicRoutines];
              
              results.forEach(result => {
                const routineIndex = fullRoutines.findIndex(r => r.id === result.routineId);
                if (routineIndex >= 0 && result.slots.length > 0) {
                  fullRoutines[routineIndex] = {
                    ...fullRoutines[routineIndex],
                    slots: result.slots
                  };
                }
              });
              
              // Final step: check and fix any missing slot data
              fixMissingSlotData(fullRoutines).then(fixedRoutines => {
                // Final update with all slot data
                setRoutines(fixedRoutines);
                
                // Cache the full data
                saveToIndexedDB(STORES.ROUTINES, fixedRoutines);
                localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
                
                console.log('All routine data loaded, fixed, and cached');
              });
            }).catch(err => {
              console.error('Error loading all routine slots:', err);
            });
          } else {
            setRoutines([]);
          }
        } catch (fetchErr: any) {
          console.error('Error fetching routines:', fetchErr);
          
          // Try to recover from cache and fix missing data
          try {
            const offlineRoutines = await getAllFromIndexedDB(STORES.ROUTINES);
            if (offlineRoutines && offlineRoutines.length > 0) {
              console.log('Using cached routines due to fetch error');
              
              // Try to fix any missing slot data in the cached routines
              const fixedRoutines = await fixMissingSlotData(offlineRoutines);
              setRoutines(fixedRoutines);
              
              // Update the cache with fixed data
              await saveToIndexedDB(STORES.ROUTINES, fixedRoutines);
            } else {
              setRoutines([]);
            }
          } catch (offlineErr) {
            console.error('Error loading fallback routines:', offlineErr);
            setRoutines([]);
          }
          
          // Run diagnostics if fetch failed
          const diagnostics = await runServiceDiagnostics();
          setDiagnosticState(diagnostics);
          setError(fetchErr.message || 'Failed to load routines');
        }
      }
    } catch (err: any) {
      console.error('Error loading routines:', err);
      setError(err.message);
      
      // If online fetch failed, try to load from IndexedDB as fallback
      if (!isOffline) {
        try {
          const offlineRoutines = await getAllFromIndexedDB(STORES.ROUTINES);
          if (offlineRoutines && offlineRoutines.length > 0) {
            console.log('Using cached routines due to fetch error');
            setRoutines(offlineRoutines);
          }
        } catch (offlineErr) {
          console.error('Error loading fallback routines:', offlineErr);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [isOffline]);

  // Add prefetch call to the main effect
  useEffect(() => {
    // Start prefetching immediately for critical path
    prefetchRoutineData();
    
    // Then verify data completeness and load full data set
    verifyRoutineDataCompleteness().then(isComplete => {
      if (!isComplete) {
        console.log('Routine data is incomplete, forcing full data load');
        loadRoutines(true);  // Force refresh of incomplete data
      } else {
        console.log('Routine data is complete, using cached data');
        loadRoutines();  // Use cached data when available
      }
    });

    // Only subscribe to changes when online
    if (!isOffline) {
      const subscription = supabase
        .channel('routines')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'routines'
          },
          () => {
            loadRoutines(true); // Force refresh on database changes
          }
        )
        .subscribe();

      return () => {
        subscription.unsubscribe();
      };
    }
  }, [isOffline, loadRoutines, prefetchRoutineData, verifyRoutineDataCompleteness]);

  // Function to fix missing slot data issues that can occur after refreshes
  const fixMissingSlotData = async (routines: Routine[]): Promise<Routine[]> => {
    if (!routines || routines.length === 0 || isOffline) return routines;
    
    try {
      // Find routines with missing slots
      const incompleteRoutines = routines.filter(r => !r.slots || r.slots.length === 0);
      
      if (incompleteRoutines.length === 0) {
        console.log('All routines have slot data, no fixes needed');
        return routines;
      }
      
      console.log(`Found ${incompleteRoutines.length} routines with missing slots, fixing...`);
      
      // Prioritize the active routine
      const activeRoutine = routines.find(r => r.isActive);
      const routinesToFix = [
        ...(activeRoutine ? [activeRoutine] : []),
        ...incompleteRoutines.filter(r => !r.isActive)
      ];
      
      // Deduplicate the array
      const uniqueRoutinesToFix = Array.from(new Map(routinesToFix.map(r => [r.id, r])).values());
      
      // Fetch slots for each routine with missing data
      const updatedRoutines = [...routines];
      
      for (const routine of uniqueRoutinesToFix) {
        console.log(`Fixing missing slots for routine ${routine.id}`);
        const { data: slots } = await supabase
          .from('routine_slots')
          .select('*')
          .eq('routine_id', routine.id);
          
        if (slots && slots.length > 0) {
          const formattedSlots = slots.map((slot: any) => ({
            id: slot.id,
            routineId: slot.routine_id,
            dayOfWeek: slot.day_of_week,
            startTime: slot.start_time,
            endTime: slot.end_time,
            roomNumber: slot.room_number || '',
            section: slot.section || '',
            courseId: slot.course_id || '',
            teacherId: slot.teacher_id || '',
            courseName: '',
            courseCode: '',
            teacherName: '',
            createdAt: slot.created_at
          }));
          
          // Update the routine with the fetched slots
          const routineIndex = updatedRoutines.findIndex(r => r.id === routine.id);
          if (routineIndex >= 0) {
            updatedRoutines[routineIndex] = {
              ...updatedRoutines[routineIndex],
              slots: formattedSlots
            };
          }
        }
      }
      
      // Return the fixed routines
      return updatedRoutines;
      
    } catch (err) {
      console.error('Error fixing missing slot data:', err);
      return routines; // Return original data on error
    }
  };

  // Add a new function to refresh slots for a specific routine
  const refreshRoutineSlots = async (routineId: string) => {
    if (!routineId) return;
    
    console.log(`Refreshing slots for routine ${routineId}`);
    try {
      const { data: slots, error } = await supabase
        .from('routine_slots')
        .select('*')
        .eq('routine_id', routineId);
        
      if (error) {
        console.error(`Error fetching slots for routine ${routineId}:`, error);
        return;
      }
      
      if (!slots || slots.length === 0) {
        console.log(`No slots found for routine ${routineId}`);
        return;
      }
      
      console.log(`Found ${slots.length} slots for routine ${routineId}`);
      
      // Get course and teacher info for the slots
      const courseIds = new Set(slots.map((s: any) => s.course_id).filter(Boolean));
      const teacherIds = new Set(slots.map((s: any) => s.teacher_id).filter(Boolean));
      
      let courses: any[] = [];
      let teachers: any[] = [];
      
      if (courseIds.size > 0) {
        const { data } = await supabase
          .from('courses')
          .select('id,name,code')
          .in('id', Array.from(courseIds));
        courses = data || [];
      }
      
      if (teacherIds.size > 0) {
        const { data } = await supabase
          .from('teachers')
          .select('id,name')
          .in('id', Array.from(teacherIds));
        teachers = data || [];
      }
      
      const courseMap = new Map();
      const teacherMap = new Map();
      
      courses.forEach(c => courseMap.set(c.id, { name: c.name, code: c.code }));
      teachers.forEach(t => teacherMap.set(t.id, t.name));
      
      // Create properly formatted slot objects
      const formattedSlots = slots.map((slot: any) => {
        const courseInfo = courseMap.get(slot.course_id) || {};
        const teacherName = teacherMap.get(slot.teacher_id) || '';
        
        return {
          id: slot.id,
          routineId: slot.routine_id,
          dayOfWeek: slot.day_of_week,
          startTime: slot.start_time,
          endTime: slot.end_time,
          roomNumber: slot.room_number || '',
          section: slot.section || '',
          courseId: slot.course_id || '',
          teacherId: slot.teacher_id || '',
          courseName: courseInfo.name || '',
          courseCode: courseInfo.code || '',
          teacherName: teacherName || '',
          createdAt: slot.created_at
        };
      });
      
      // Update the routine in state with the fetched slots
      setRoutines(prev => 
        prev.map(routine => 
          routine.id === routineId
            ? { ...routine, slots: formattedSlots }
            : routine
        )
      );
      
      // Also update in IndexedDB
      const updatedRoutines = await getAllFromIndexedDB(STORES.ROUTINES);
      if (updatedRoutines) {
        const updatedData = updatedRoutines.map(routine => 
          routine.id === routineId
            ? { ...routine, slots: formattedSlots }
            : routine
        );
        await saveToIndexedDB(STORES.ROUTINES, updatedData);
      }
      
    } catch (err) {
      console.error(`Error refreshing slots for routine ${routineId}:`, err);
    }
  };

  // Enhanced offline sync with improved progress tracking and error handling
  const syncOfflineChanges = async () => {
    if (isOffline || syncInProgress) return; // Only sync when online and not already syncing
    
    try {
      setSyncInProgress(true);
      console.log('Starting routine sync process...');
      
      const offlineRoutines = await getAllFromIndexedDB(STORES.ROUTINES);
      let syncedRoutines = [...offlineRoutines];
      let hasChanges = false;
      let syncErrors = 0;
      
      // Process each routine for offline changes
      for (const routine of offlineRoutines) {
        // Skip routines without offline changes
        if (!routine._isOffline && 
            !routine._isOfflineUpdated && 
            !routine._isOfflineDeleted && 
            !routine._needsActivationSync && 
            !routine._needsDeactivationSync && 
            !routine.slots?.some((slot: RoutineSlot) => slot._isOffline || slot._isOfflineUpdated || slot._isOfflineDeleted)) {
          continue;
        }
        
        console.log(`Syncing routine: ${routine.id} (${routine.name})`);
        
        // Handle routine deletions
        if (routine._isOfflineDeleted) {
          try {
            await deleteRoutineService(routine.id);
            syncedRoutines = syncedRoutines.filter(r => r.id !== routine.id);
            hasChanges = true;
            console.log(`Deleted routine: ${routine.id}`);
          } catch (err) {
            console.error(`Failed to sync delete for routine ${routine.id}:`, err);
            syncErrors++;
          }
          continue;
        }
        
        // Handle activation/deactivation
        if (routine._needsActivationSync) {
          try {
            await activateRoutineService(routine.id);
            const routineIndex = syncedRoutines.findIndex(r => r.id === routine.id);
            if (routineIndex >= 0) {
              syncedRoutines[routineIndex] = { 
                ...syncedRoutines[routineIndex], 
                isActive: true,
                _needsActivationSync: undefined 
              };
              hasChanges = true;
            }
            console.log(`Activated routine: ${routine.id}`);
          } catch (err) {
            console.error(`Failed to sync activation for routine ${routine.id}:`, err);
            syncErrors++;
          }
        } else if (routine._needsDeactivationSync) {
          try {
            await deactivateRoutineService(routine.id);
            const routineIndex = syncedRoutines.findIndex(r => r.id === routine.id);
            if (routineIndex >= 0) {
              syncedRoutines[routineIndex] = { 
                ...syncedRoutines[routineIndex], 
                isActive: false,
                _needsDeactivationSync: undefined 
              };
              hasChanges = true;
            }
            console.log(`Deactivated routine: ${routine.id}`);
          } catch (err) {
            console.error(`Failed to sync deactivation for routine ${routine.id}:`, err);
            syncErrors++;
          }
        }
        
        // Handle new routines created offline
        if (routine._isOffline) {
          try {
            // Remove offline flags and generate clean data
            const { _isOffline, id, ...routineData } = routine;
            const newRoutine = await createRoutineService(routineData);
            
            // Replace the temp routine with the server one
            syncedRoutines = syncedRoutines.filter(r => r.id !== routine.id);
            syncedRoutines.push(newRoutine);
            hasChanges = true;
            console.log(`Created new routine: ${newRoutine.id} (replaced temp: ${routine.id})`);
          } catch (err) {
            console.error(`Failed to sync new routine ${routine.id}:`, err);
            syncErrors++;
          }
          continue;
        }
        
        // Handle routine updates
        if (routine._isOfflineUpdated) {
          try {
            // Create a clean version without offline flags
            const { _isOfflineUpdated, _isOffline, _needsActivationSync, _needsDeactivationSync, slots, ...routineData } = routine;
            await updateRoutineService(routine.id, routineData);
            
            // Update the synced version
            const index = syncedRoutines.findIndex(r => r.id === routine.id);
            if (index >= 0) {
              syncedRoutines[index] = { 
                ...syncedRoutines[index], 
                ...routineData,
                _isOfflineUpdated: undefined 
              };
              hasChanges = true;
            }
            console.log(`Updated routine: ${routine.id}`);
          } catch (err) {
            console.error(`Failed to sync routine update ${routine.id}:`, err);
            syncErrors++;
          }
        }
        
        // Handle slot changes
        if (routine.slots && routine.slots.length > 0) {
          let slotsChanged = false;
          const syncedSlots = [...routine.slots];
          
          for (const slot of routine.slots) {
            // Skip slots without offline changes
            if (!slot._isOffline && !slot._isOfflineUpdated && !slot._isOfflineDeleted) {
              continue;
            }
            
            // Handle slot deletions
            if (slot._isOfflineDeleted) {
              try {
                await deleteRoutineSlotService(routine.id, slot.id);
                const slotIndex = syncedSlots.findIndex(s => s.id === slot.id);
                if (slotIndex >= 0) {
                  syncedSlots.splice(slotIndex, 1);
                  slotsChanged = true;
                }
                console.log(`Deleted slot: ${slot.id} from routine: ${routine.id}`);
              } catch (err) {
                console.error(`Failed to sync slot deletion ${slot.id}:`, err);
                syncErrors++;
              }
              continue;
            }
            
            // Handle new slots
            if (slot._isOffline) {
              try {
                const { _isOffline, id, routineId, createdAt, ...slotData } = slot;
                const newSlot = await addRoutineSlotService(routine.id, slotData);
                
                // Replace temp slot with server one
                const slotIndex = syncedSlots.findIndex(s => s.id === slot.id);
                if (slotIndex >= 0) {
                  syncedSlots[slotIndex] = newSlot;
                  slotsChanged = true;
                }
                console.log(`Created new slot: ${newSlot.id} (replaced temp: ${slot.id})`);
              } catch (err) {
                console.error(`Failed to sync new slot ${slot.id}:`, err);
                syncErrors++;
              }
              continue;
            }
            
            // Handle slot updates
            if (slot._isOfflineUpdated) {
              try {
                const { _isOfflineUpdated, _isOffline, ...slotData } = slot;
                await updateRoutineSlotService(routine.id, slot.id, slotData);
                
                // Update slot in synced version
                const slotIndex = syncedSlots.findIndex(s => s.id === slot.id);
                if (slotIndex >= 0) {
                  syncedSlots[slotIndex] = { 
                    ...slotData, 
                    id: slot.id, 
                    routineId: routine.id,
                    _isOfflineUpdated: undefined
                  };
                  slotsChanged = true;
                }
                console.log(`Updated slot: ${slot.id}`);
              } catch (err) {
                console.error(`Failed to sync slot update ${slot.id}:`, err);
                syncErrors++;
              }
            }
          }
          
          // Update routine with synced slots
          if (slotsChanged) {
            const routineIndex = syncedRoutines.findIndex(r => r.id === routine.id);
            if (routineIndex >= 0) {
              syncedRoutines[routineIndex] = {
                ...syncedRoutines[routineIndex],
                slots: syncedSlots
              };
              hasChanges = true;
            }
          }
        }
      }
      
      // Save synced routines back to IndexedDB and update state
      if (hasChanges) {
        await saveToIndexedDB(STORES.ROUTINES, syncedRoutines);
        setRoutines(syncedRoutines);
        // Update timestamp after successful sync
        localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
        console.log(`Offline routine changes synced with ${syncErrors} errors`);
      } else {
        console.log('No offline routine changes to sync');
      }
      
    } catch (err) {
      console.error('Error syncing offline routine changes:', err);
      setError('Failed to sync offline changes');
    } finally {
      setSyncInProgress(false);
    }
  };

  const createRoutine = async (routine: Omit<Routine, 'id' | 'createdAt'>) => {
    try {
      setError(null);
      
      if (isOffline) {
        // In offline mode, create a temporary ID and store locally
        const tempId = `temp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        const offlineRoutine: Routine = {
          ...routine,
          id: tempId,
          createdAt: new Date().toISOString(),
          slots: [],
          _isOffline: true // Mark as created offline for sync later
        };
        
        await saveToIndexedDB(STORES.ROUTINES, offlineRoutine);
        setRoutines(prev => [offlineRoutine, ...prev]);
        return offlineRoutine;
      } else {
        // Online mode - create on server
        const newRoutine = await createRoutineService(routine);
        setRoutines(prev => [newRoutine, ...prev]);
        
        // Update in IndexedDB
        await saveToIndexedDB(STORES.ROUTINES, newRoutine);
        
        return newRoutine;
      }
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  };

  const updateRoutine = async (id: string, updates: Partial<Routine>) => {
    try {
      setError(null);
      
      if (isOffline) {
        // In offline mode, update local copy
        const existingRoutines = await getAllFromIndexedDB(STORES.ROUTINES);
        const routineToUpdate = existingRoutines.find((r: Routine) => r.id === id);
        
        if (routineToUpdate) {
          const updatedRoutine = { ...routineToUpdate, ...updates, _isOfflineUpdated: true };
          await saveToIndexedDB(STORES.ROUTINES, updatedRoutine);
          
          setRoutines(prev =>
            prev.map(routine =>
              routine.id === id ? { ...routine, ...updates } : routine
            )
          );
        }
      } else {
        // Online mode - update on server
        await updateRoutineService(id, updates);
        
        setRoutines(prev =>
          prev.map(routine =>
            routine.id === id ? { ...routine, ...updates } : routine
          )
        );
        
        // Update in IndexedDB
        const existingRoutines = await getAllFromIndexedDB(STORES.ROUTINES);
        const routineToUpdate = existingRoutines.find((r: Routine) => r.id === id);
        
        if (routineToUpdate) {
          const updatedRoutine = { ...routineToUpdate, ...updates };
          await saveToIndexedDB(STORES.ROUTINES, updatedRoutine);
        }
      }
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  };

  const deleteRoutine = async (id: string) => {
    try {
      setError(null);
      
      if (isOffline) {
        // In offline mode, mark for deletion but don't remove from IndexedDB yet
        // Instead, we'll add a flag to delete it when back online
        const existingRoutines = await getAllFromIndexedDB(STORES.ROUTINES);
        const routineToDelete = existingRoutines.find((r: Routine) => r.id === id);
        
        if (routineToDelete) {
          const markedRoutine = { ...routineToDelete, _isOfflineDeleted: true };
          await saveToIndexedDB(STORES.ROUTINES, markedRoutine);
        }
        
        // Remove from state
        setRoutines(prev => prev.filter(routine => routine.id !== id));
      } else {
        // Online mode - delete from server
        await deleteRoutineService(id);
        
        // Remove from state
        setRoutines(prev => prev.filter(routine => routine.id !== id));
        
        // Properly clean up IndexedDB to prevent deleted routines from reappearing
        try {
          // Get all routines from IndexedDB
          const existingRoutines = await getAllFromIndexedDB(STORES.ROUTINES);
          
          // Remove the deleted routine from the array
          const filteredRoutines = existingRoutines.filter((r: Routine) => r.id !== id);
          
          // Clear the store and save the filtered routines
          await clearIndexedDBStore(STORES.ROUTINES);
          
          // If there are remaining routines, save them back
          if (filteredRoutines.length > 0) {
            await saveToIndexedDB(STORES.ROUTINES, filteredRoutines);
          }
          
          // Force cache invalidation by updating the timestamp
          localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
          
          console.log(`Routine ${id} successfully deleted from IndexedDB`);
        } catch (dbErr) {
          console.error('Error updating IndexedDB after deletion:', dbErr);
        }
      }
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  };

  const addRoutineSlot = async (routineId: string, slot: Omit<RoutineSlot, 'id' | 'routineId' | 'createdAt'>) => {
    try {
      setError(null);
      console.log('Adding routine slot:', { routineId, slot }); // Debug log
      
      if (isOffline) {
        // In offline mode, create temporary slot
        const tempId = `temp-slot-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        const newSlot: RoutineSlot = {
          ...slot,
          id: tempId,
          routineId,
          createdAt: new Date().toISOString(),
          _isOffline: true // Mark as created offline
        };
        
        // Update routine in state and IndexedDB
        const updatedRoutines = await getAllFromIndexedDB(STORES.ROUTINES);
        const routineIndex = updatedRoutines.findIndex((r: Routine) => r.id === routineId);
        
        if (routineIndex >= 0) {
          const routine = updatedRoutines[routineIndex];
          const updatedRoutine = {
            ...routine,
            slots: [...(routine.slots || []), newSlot]
          };
          
          updatedRoutines[routineIndex] = updatedRoutine;
          await saveToIndexedDB(STORES.ROUTINES, updatedRoutines);
          
          setRoutines(prev =>
            prev.map(r =>
              r.id === routineId
                ? {
                    ...r,
                    slots: [...(r.slots || []), newSlot]
                  }
                : r
            )
          );
          
          return newSlot;
        } else {
          throw new Error('Routine not found');
        }
      } else {
        // Online mode - add slot on server
        const newSlot = await addRoutineSlotService(routineId, slot);
        console.log('New slot created:', newSlot); // Debug log
        
        // Update routine in state
        setRoutines(prev =>
          prev.map(r =>
            r.id === routineId
              ? {
                  ...r,
                  slots: [...(r.slots || []), newSlot]
                }
              : r
          )
        );
        
        // Update in IndexedDB
        try {
          const existingRoutines = await getAllFromIndexedDB(STORES.ROUTINES);
          const routineToUpdate = existingRoutines.find((r: Routine) => r.id === routineId);
          
          if (routineToUpdate) {
            const updatedRoutine = {
              ...routineToUpdate,
              slots: [...(routineToUpdate.slots || []), newSlot]
            };
            await saveToIndexedDB(STORES.ROUTINES, updatedRoutine);
          }
        } catch (dbErr) {
          console.error('Error updating IndexedDB after adding slot:', dbErr);
        }
        
        return newSlot;
      }
    } catch (err: any) {
      console.error('Error adding routine slot:', err);
      setError(err.message);
      throw err;
    }
  };

  const updateRoutineSlot = async (routineId: string, slotId: string, updates: Partial<RoutineSlot>) => {
    try {
      setError(null);
      
      if (isOffline) {
        // In offline mode, update locally
        const existingRoutines = await getAllFromIndexedDB(STORES.ROUTINES);
        const routineIndex = existingRoutines.findIndex((r: Routine) => r.id === routineId);
        
        if (routineIndex >= 0) {
          const routine = existingRoutines[routineIndex];
          const updatedRoutine = {
            ...routine,
            slots: routine.slots?.map((slot: RoutineSlot) =>
              slot.id === slotId 
                ? { ...slot, ...updates, _isOfflineUpdated: true } 
                : slot
            )
          };
          
          existingRoutines[routineIndex] = updatedRoutine;
          await saveToIndexedDB(STORES.ROUTINES, existingRoutines);
          
          setRoutines(prev =>
            prev.map(r =>
              r.id === routineId
                ? {
                    ...r,
                    slots: r.slots?.map((slot: RoutineSlot) =>
                      slot.id === slotId ? { ...slot, ...updates } : slot
                    )
                  }
                : r
            )
          );
        }
      } else {
        // Online mode
        await updateRoutineSlotService(routineId, slotId, updates);
        
        setRoutines(prev =>
          prev.map(routine =>
            routine.id === routineId
              ? {
                  ...routine,
                  slots: routine.slots?.map((slot: RoutineSlot) =>
                    slot.id === slotId ? { ...slot, ...updates } : slot
                  )
                }
              : routine
          )
        );
        
        // Update in IndexedDB
        try {
          const existingRoutines = await getAllFromIndexedDB(STORES.ROUTINES);
          const routineIndex = existingRoutines.findIndex((r: Routine) => r.id === routineId);
          
          if (routineIndex >= 0) {
            const routine = existingRoutines[routineIndex];
            const updatedRoutine = {
              ...routine,
              slots: routine.slots?.map((slot: RoutineSlot) =>
                slot.id === slotId ? { ...slot, ...updates } : slot
              )
            };
            
            existingRoutines[routineIndex] = updatedRoutine;
            await saveToIndexedDB(STORES.ROUTINES, existingRoutines);
          }
        } catch (dbErr) {
          console.error('Error updating IndexedDB after slot update:', dbErr);
        }
      }
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  };

  const deleteRoutineSlot = async (routineId: string, slotId: string) => {
    try {
      setError(null);
      
      if (isOffline) {
        // Mark slot for deletion in offline mode
        const existingRoutines = await getAllFromIndexedDB(STORES.ROUTINES);
        const routineIndex = existingRoutines.findIndex((r: Routine) => r.id === routineId);
        
        if (routineIndex >= 0) {
          const routine = existingRoutines[routineIndex];
          
          // If it's a temp slot (created offline), remove it entirely 
          // Otherwise mark it for deletion with a flag
          const updatedSlots = routine.slots?.map((slot: RoutineSlot) => 
            slot.id === slotId ? { ...slot, _isOfflineDeleted: true } : slot
          ).filter((slot: RoutineSlot) => 
            !(slot.id === slotId && slot._isOffline) // Remove temporary slots immediately
          );
          
          const updatedRoutine = {
            ...routine,
            slots: updatedSlots
          };
          
          existingRoutines[routineIndex] = updatedRoutine;
          await saveToIndexedDB(STORES.ROUTINES, existingRoutines);
        }
        
        // Update state
        setRoutines(prev =>
          prev.map(routine =>
            routine.id === routineId
              ? {
                  ...routine,
                  slots: routine.slots?.filter((slot: RoutineSlot) => slot.id !== slotId)
                }
              : routine
          )
        );
      } else {
        // Online mode
        await deleteRoutineSlotService(routineId, slotId);
        
        setRoutines(prev =>
          prev.map(routine =>
            routine.id === routineId
              ? {
                  ...routine,
                  slots: routine.slots?.filter((slot: RoutineSlot) => slot.id !== slotId)
                }
              : routine
          )
        );
        
        // Update in IndexedDB
        try {
          const existingRoutines = await getAllFromIndexedDB(STORES.ROUTINES);
          const routineIndex = existingRoutines.findIndex((r: Routine) => r.id === routineId);
          
          if (routineIndex >= 0) {
            const routine = existingRoutines[routineIndex];
            const updatedRoutine = {
              ...routine,
              slots: routine.slots?.filter((slot: RoutineSlot) => slot.id !== slotId)
            };
            
            existingRoutines[routineIndex] = updatedRoutine;
            await saveToIndexedDB(STORES.ROUTINES, existingRoutines);
          }
        } catch (dbErr) {
          console.error('Error updating IndexedDB after slot deletion:', dbErr);
        }
      }
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  };

  /**
   * Bulk import multiple routine slots from JSON data
   */
  const bulkImportSlots = async (routineId: string, slotsData: any[]): Promise<{ success: number; errors: any[] }> => {
    if (isOffline) {
      return {
        success: 0,
        errors: [{ message: 'Bulk import is not available in offline mode' }]
      };
    }

    try {
      // Import slots in bulk
      const result = await bulkImportRoutineSlotsService(routineId, slotsData);
      
      // Refresh routines data to include new slots
      await loadRoutines(true);
      
      return result;
    } catch (error: any) {
      console.error('Error bulk importing slots:', error);
      return {
        success: 0,
        errors: [{ message: error.message || 'Failed to import slots' }]
      };
    }
  };

  // Export a routine with all its slots as a JSON file
  const exportRoutine = async (routineId: string) => {
    try {
      setLoading(true);
      const data = await exportRoutineWithSlotsService(routineId);
      return data;
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };
  
  // Get all semesters for filtering
  const getSemesters = async () => {
    try {
      return await getAllSemestersService();
    } catch (err: any) {
      console.error('Error fetching semesters:', err);
      return [];
    }
  };
  
  // Get routines filtered by semester
  const getRoutinesBySemester = async (semester: string) => {
    try {
      setLoading(true);
      return await getRoutinesBySemesterService(semester);
    } catch (err: any) {
      setError(err.message);
      return [];
    } finally {
      setLoading(false);
    }
  };

  // Refresh routines with fresh data from server
  const refreshRoutines = useCallback(async () => {
    if (!isOffline) {
      // For admin dashboard, always load fresh data without cache
      console.log('Admin dashboard: Refreshing routines with fresh data');
      
      // Load fresh data from server
      await loadRoutines(true);
    }
  }, [isOffline, loadRoutines]);

  // Add the diagnostics function to the exported hook
  const checkServiceHealth = useCallback(async () => {
    const diagnostics = await runServiceDiagnostics();
    setDiagnosticState(diagnostics);
    return diagnostics;
  }, []);

  return {
    routines,
    loading,
    error,
    syncInProgress,
    diagnosticState,
    checkServiceHealth,
    refreshRoutineSlots,
    prefetchRoutineData,
    loadRoutines,
    syncOfflineChanges,
    createRoutine,
    updateRoutine,
    deleteRoutine,
    addRoutineSlot,
    updateRoutineSlot,
    deleteRoutineSlot,
    bulkImportSlots,
    exportRoutine,
    activateRoutine: async (routineId: string) => {
      try {
        setError(null);
        
        if (isOffline) {
          // When offline, just update state but mark for syncing later
          setRoutines(prev => 
            prev.map(routine => ({
              ...routine,
              isActive: routine.id === routineId,
              _needsActivationSync: routine.id === routineId ? true : undefined
            }))
          );
          
          // Update IndexedDB
          const existingRoutines = await getAllFromIndexedDB(STORES.ROUTINES);
          const updatedRoutines = existingRoutines.map((routine: Routine) => ({
            ...routine,
            isActive: routine.id === routineId,
            _needsActivationSync: routine.id === routineId ? true : undefined
          }));
          
          await saveToIndexedDB(STORES.ROUTINES, updatedRoutines);
        } else {
          // Online mode, use the service
          await activateRoutineService(routineId);
          
          // Update state
          setRoutines(prev => 
            prev.map(routine => ({
              ...routine,
              isActive: routine.id === routineId
            }))
          );
          
          // Update in IndexedDB
          const existingRoutines = await getAllFromIndexedDB(STORES.ROUTINES);
          const updatedRoutines = existingRoutines.map((routine: Routine) => ({
            ...routine,
            isActive: routine.id === routineId
          }));
          
          await saveToIndexedDB(STORES.ROUTINES, updatedRoutines);
        }
      } catch (err: any) {
        setError(err.message);
        throw err;
      }
    },
    deactivateRoutine: async (routineId: string) => {
      try {
        setError(null);
        
        if (isOffline) {
          // When offline, just update state but mark for syncing later
          setRoutines(prev => 
            prev.map(routine => ({
              ...routine,
              isActive: routine.id === routineId ? false : routine.isActive,
              _needsDeactivationSync: routine.id === routineId ? true : undefined
            }))
          );
          
          // Update IndexedDB
          const existingRoutines = await getAllFromIndexedDB(STORES.ROUTINES);
          const updatedRoutines = existingRoutines.map((routine: Routine) => ({
            ...routine,
            isActive: routine.id === routineId ? false : routine.isActive,
            _needsDeactivationSync: routine.id === routineId ? true : undefined
          }));
          
          await saveToIndexedDB(STORES.ROUTINES, updatedRoutines);
        } else {
          // Online mode, use the service
          await deactivateRoutineService(routineId);
          
          // Update state
          setRoutines(prev => 
            prev.map(routine => ({
              ...routine,
              isActive: routine.id === routineId ? false : routine.isActive
            }))
          );
          
          // Update in IndexedDB
          const existingRoutines = await getAllFromIndexedDB(STORES.ROUTINES);
          const updatedRoutines = existingRoutines.map((routine: Routine) => ({
            ...routine,
            isActive: routine.id === routineId ? false : routine.isActive
          }));
          
          await saveToIndexedDB(STORES.ROUTINES, updatedRoutines);
        }
      } catch (err: any) {
        setError(err.message);
        throw err;
      }
    },
    getSemesters,
    getRoutinesBySemester
  };
}