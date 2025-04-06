import { supabase } from '../lib/supabase';
import type { Routine, RoutineSlot } from '../types/routine';

export async function fetchRoutines(): Promise<Routine[]> {
  try {
    console.log('Fetching routines data from Supabase');
    
    // Make a single query to fetch routines with slots and prefetch all related data
    const { data: routines, error: routinesError } = await supabase
      .from('routines')
      .select(`
        *,
        slots:routine_slots (
          id,
          day_of_week,
          start_time,
          end_time,
          room_number,
          section,
          course_id,
          teacher_id,
          created_at
        )
      `)
      .order('created_at', { ascending: false });

    if (routinesError) {
      console.error('Error fetching routines:', routinesError);
      throw routinesError;
    }
    
    if (!routines || routines.length === 0) {
      console.log('No routines found in database');
      return [];
    }

    console.log(`Found ${routines.length} routines in database`);
    
    // Check if any of the routines have slots
    const routinesWithSlots = routines.filter(r => r.slots && r.slots.length > 0);
    console.log(`${routinesWithSlots.length} of ${routines.length} routines have slots data`);
    
    // If some routines are missing slots, do a direct query for those
    if (routinesWithSlots.length < routines.length) {
      const routinesWithoutSlots = routines.filter(r => !r.slots || r.slots.length === 0);
      console.log(`Fetching slots separately for ${routinesWithoutSlots.length} routines`);
      
      for (const routine of routinesWithoutSlots) {
        try {
          const { data: slots, error: slotsError } = await supabase
            .from('routine_slots')
            .select('*')
            .eq('routine_id', routine.id);
            
          if (slotsError) {
            console.error(`Error fetching slots for routine ${routine.id}:`, slotsError);
          } else if (slots && slots.length > 0) {
            console.log(`Found ${slots.length} slots for routine ${routine.id}`);
            routine.slots = slots;
          } else {
            console.log(`No slots found for routine ${routine.id}`);
            routine.slots = [];
          }
        } catch (err) {
          console.error(`Error in separate slots fetch for routine ${routine.id}:`, err);
        }
      }
    }

    // Extract unique course and teacher IDs for batch fetching
    const courseIds = new Set<string>();
    const teacherIds = new Set<string>();
    
    routines.forEach(routine => {
      if (!routine.slots) return;
      
      routine.slots.forEach((slot: any) => {
        if (slot.course_id) courseIds.add(slot.course_id);
        if (slot.teacher_id) teacherIds.add(slot.teacher_id);
      });
    });
    
    console.log(`Need to fetch ${courseIds.size} courses and ${teacherIds.size} teachers for slots`);
    
    // Define type for supabase responses
    type SupabaseResponse<T> = { data: T | null; error: any };
    
    // Only fetch courses and teachers if we have IDs
    let coursesResponse: SupabaseResponse<any[]>;
    let teachersResponse: SupabaseResponse<any[]>;
    
    if (courseIds.size > 0) {
      coursesResponse = await supabase
        .from('courses')
        .select('id,name,code')
        .in('id', Array.from(courseIds));
    } else {
      coursesResponse = { data: [], error: null };
    }
    
    if (teacherIds.size > 0) {
      teachersResponse = await supabase
        .from('teachers')
        .select('id,name')
        .in('id', Array.from(teacherIds));
    } else {
      teachersResponse = { data: [], error: null };
    }
    
    if (coursesResponse.error) {
      console.error('Error fetching courses:', coursesResponse.error);
    }
    
    if (teachersResponse.error) {
      console.error('Error fetching teachers:', teachersResponse.error);
    }
    
    const allCourses = coursesResponse.data || [];
    const allTeachers = teachersResponse.data || [];

    console.log(`Fetched ${routines.length} routines, ${allCourses.length} courses, ${allTeachers.length} teachers`);

    // Create lookup maps for faster access
    const courseMap = new Map<string, {name?: string; code?: string}>();
    const teacherMap = new Map<string, string>();
    
    allCourses.forEach(course => courseMap.set(course.id, { name: course.name, code: course.code }));
    allTeachers.forEach(teacher => teacherMap.set(teacher.id, teacher.name));

    // Map the database results to our application model
    const mappedRoutines = routines.map(routine => {
      // Check if routine has slots
      const hasSlots = routine.slots && routine.slots.length > 0;
      if (!hasSlots) {
        console.log(`Routine ${routine.id} (${routine.name}) has no slots after processing`);
      } else {
        console.log(`Routine ${routine.id} (${routine.name}) has ${routine.slots.length} slots`);
      }
      
      return {
        id: routine.id,
        name: routine.name,
        description: routine.description,
        semester: routine.semester,
        isActive: routine.is_active,
        createdAt: routine.created_at,
        createdBy: routine.created_by,
        slots: (routine.slots || []).map((slot: any) => {
          // Get course and teacher info from maps (constant time lookup)
          const courseInfo = courseMap.get(slot.course_id) || {};
          const teacherName = teacherMap.get(slot.teacher_id) || '';
          
          return {
            id: slot.id,
            routineId: routine.id,
            courseId: slot.course_id || '',
            teacherId: slot.teacher_id || '',
            courseName: courseInfo.name || '',
            courseCode: courseInfo.code || '',
            teacherName: teacherName || '',
            dayOfWeek: slot.day_of_week,
            startTime: slot.start_time,
            endTime: slot.end_time,
            roomNumber: slot.room_number || '',
            section: slot.section || '',
            createdAt: slot.created_at
          };
        })
      };
    });
    
    return mappedRoutines;
  } catch (error) {
    console.error('Error fetching routines:', error);
    throw error;
  }
}

export async function createRoutine(routine: Omit<Routine, 'id' | 'createdAt' | 'createdBy'>): Promise<Routine> {
  try {
    // Create database insert object with correct field mappings
    const dbRoutine = {
      name: routine.name,
      description: routine.description,
      semester: routine.semester,
      is_active: routine.isActive
    };
    
    const { data, error } = await supabase
      .from('routines')
      .insert(dbRoutine)
      .select()
      .single();

    if (error) throw error;
    
    // Map database fields back to JavaScript camelCase
    return {
      id: data.id,
      name: data.name,
      description: data.description,
      semester: data.semester,
      isActive: data.is_active,
      createdAt: data.created_at,
      createdBy: data.created_by,
      slots: []
    };
  } catch (error) {
    console.error('Error creating routine:', error);
    throw error;
  }
}

export async function updateRoutine(id: string, updates: Partial<Routine>): Promise<void> {
  try {
    // Create database update object with correct field mappings
    const dbUpdates: any = {};
    
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.description !== undefined) dbUpdates.description = updates.description;
    if (updates.semester !== undefined) dbUpdates.semester = updates.semester;
    if (updates.isActive !== undefined) dbUpdates.is_active = updates.isActive;
    
    const { error } = await supabase
      .from('routines')
      .update(dbUpdates)
      .eq('id', id);

    if (error) throw error;
  } catch (error) {
    console.error('Error updating routine:', error);
    throw error;
  }
}

export async function deleteRoutine(id: string): Promise<void> {
  try {
    const { error } = await supabase
      .from('routines')
      .delete()
      .eq('id', id);

    if (error) throw error;
  } catch (error) {
    console.error('Error deleting routine:', error);
    throw error;
  }
}

export async function addRoutineSlot(
  routineId: string,
  slot: Omit<RoutineSlot, 'id' | 'routineId' | 'createdAt'>
): Promise<RoutineSlot> {
  try {
    console.log('Service: Adding routine slot', { routineId, slot });

    if (!routineId) {
      console.error('Missing routineId');
      throw new Error('Missing routine ID');
    }
    
    if (!slot) {
      console.error('Missing slot data');
      throw new Error('Missing slot data');
    }
    
    if (!slot.dayOfWeek) {
      console.error('Missing dayOfWeek');
      throw new Error('Day of week is required');
    }
    
    if (!slot.startTime) {
      console.error('Missing startTime');
      throw new Error('Start time is required');
    }
    
    if (!slot.endTime) {
      console.error('Missing endTime');
      throw new Error('End time is required');
    }

    // Get course name if not provided but courseId is
    let courseName = slot.courseName || '';
    if (slot.courseId && !courseName) {
      const { data: course } = await supabase
        .from('courses')
        .select('name')
        .eq('id', slot.courseId)
        .single();
      
      if (course) {
        courseName = course.name;
      }
    }

    // Get teacher name if not provided but teacherId is
    let teacherName = slot.teacherName || '';
    if (slot.teacherId && !teacherName) {
      const { data: teacher } = await supabase
        .from('teachers')
        .select('name')
        .eq('id', slot.teacherId)
        .single();
      
      if (teacher) {
        teacherName = teacher.name;
      }
    }

    try {
      // First, try to insert with course_name and teacher_name
      const { data, error } = await supabase
        .from('routine_slots')
        .insert({
          routine_id: routineId,
          day_of_week: slot.dayOfWeek,
          start_time: slot.startTime,
          end_time: slot.endTime,
          room_number: slot.roomNumber || null,
          section: slot.section || null,
          course_id: slot.courseId || null,
          teacher_id: slot.teacherId || null,
          course_name: courseName || null,
          teacher_name: teacherName || null
        })
        .select('*')
        .single();

      if (error) {
        // If we get an error about missing columns, try without those columns
        if (error.message.includes('column "course_name" of relation "routine_slots" does not exist') ||
            error.message.includes('column "teacher_name" of relation "routine_slots" does not exist')) {
          
          console.log('Falling back to insertion without course_name/teacher_name columns');
          
          // Fallback: insert without the missing columns
          const { data: fallbackData, error: fallbackError } = await supabase
            .from('routine_slots')
            .insert({
              routine_id: routineId,
              day_of_week: slot.dayOfWeek,
              start_time: slot.startTime,
              end_time: slot.endTime,
              room_number: slot.roomNumber || null,
              section: slot.section || null,
              course_id: slot.courseId || null,
              teacher_id: slot.teacherId || null
            })
            .select('*')
            .single();
            
          if (fallbackError) {
            console.error('Fallback insertion failed:', fallbackError);
            throw fallbackError;
          }
          
          if (!fallbackData) {
            console.error('No data returned from fallback insertion');
            throw new Error('Failed to create routine slot: No data returned');
          }
          
          // Return the fallback data with manually added course/teacher names
          return {
            id: fallbackData.id,
            routineId: fallbackData.routine_id,
            dayOfWeek: fallbackData.day_of_week,
            startTime: fallbackData.start_time,
            endTime: fallbackData.end_time,
            roomNumber: fallbackData.room_number || '',
            section: fallbackData.section || '',
            courseId: fallbackData.course_id || '',
            teacherId: fallbackData.teacher_id || '',
            courseName: courseName,
            teacherName: teacherName,
            createdAt: fallbackData.created_at
          };
        } else {
          console.error('Error creating routine slot:', error);
          throw error;
        }
      }
      
      if (!data) {
        console.error('No data returned from slot insertion');
        throw new Error('Failed to create routine slot: No data returned');
      }

      // Return the data with proper mapping
      return {
        id: data.id,
        routineId: data.routine_id,
        dayOfWeek: data.day_of_week,
        startTime: data.start_time,
        endTime: data.end_time,
        roomNumber: data.room_number || '',
        section: data.section || '',
        courseId: data.course_id || '',
        teacherId: data.teacher_id || '',
        courseName: courseName,
        teacherName: teacherName,
        createdAt: data.created_at
      };
    } catch (innerError) {
      console.error('Error in slot insertion routine:', innerError);
      throw innerError;
    }
  } catch (error) {
    console.error('Error adding routine slot:', error);
    throw error;
  }
}

export async function updateRoutineSlot(
  routineId: string,
  slotId: string,
  updates: Partial<RoutineSlot>
): Promise<void> {
  try {
    if (!routineId) {
      throw new Error('Missing routine ID');
    }
    
    if (!slotId) {
      throw new Error('Missing slot ID');
    }
    
    console.log('Service: Updating routine slot', { routineId, slotId, updates });

    // Create database update object with correct field mappings
    const dbUpdates: any = {};
    
    // Map JavaScript camelCase fields to database snake_case fields
    if (updates.dayOfWeek !== undefined) dbUpdates.day_of_week = updates.dayOfWeek;
    if (updates.startTime !== undefined) dbUpdates.start_time = updates.startTime;
    if (updates.endTime !== undefined) dbUpdates.end_time = updates.endTime;
    if (updates.roomNumber !== undefined) dbUpdates.room_number = updates.roomNumber;
    if (updates.section !== undefined) dbUpdates.section = updates.section;
    if (updates.courseId !== undefined) dbUpdates.course_id = updates.courseId;
    if (updates.teacherId !== undefined) dbUpdates.teacher_id = updates.teacherId;

    // Try to update course_name and teacher_name if available
    try {
      // Get current slot data to compare and see what needs updating
      const { data: currentSlot, error: getError } = await supabase
        .from('routine_slots')
        .select('*')
        .eq('id', slotId)
        .eq('routine_id', routineId)
        .single();
        
      if (getError) {
        console.error('Error retrieving current slot data:', getError);
        throw getError;
      }
      
      if (!currentSlot) {
        throw new Error(`Slot ${slotId} not found in routine ${routineId}`);
      }
      
      // If courseId changed, update course name
      if (updates.courseId && updates.courseId !== currentSlot.course_id) {
        try {
          const { data: course } = await supabase
            .from('courses')
            .select('name')
            .eq('id', updates.courseId)
            .single();
            
          if (course) {
            dbUpdates.course_name = course.name;
          }
        } catch (courseError) {
          console.warn('Could not fetch course name, continuing without it:', courseError);
        }
      }
      
      // If teacherId changed, update teacher name
      if (updates.teacherId && updates.teacherId !== currentSlot.teacher_id) {
        try {
          const { data: teacher } = await supabase
            .from('teachers')
            .select('name')
            .eq('id', updates.teacherId)
            .single();
            
          if (teacher) {
            dbUpdates.teacher_name = teacher.name;
          }
        } catch (teacherError) {
          console.warn('Could not fetch teacher name, continuing without it:', teacherError);
        }
      }
      
      // First try with course_name and teacher_name
      const { error } = await supabase
        .from('routine_slots')
        .update(dbUpdates)
        .eq('id', slotId)
        .eq('routine_id', routineId);

      if (error) {
        // If columns don't exist, retry without those columns
        if (error.message.includes('column "course_name" of relation "routine_slots" does not exist') ||
            error.message.includes('column "teacher_name" of relation "routine_slots" does not exist')) {
          
          console.log('Columns course_name/teacher_name not available, retrying update without them');
          
          // Remove the course_name and teacher_name fields
          const { course_name, teacher_name, ...cleanedUpdates } = dbUpdates;
          
          const { error: fallbackError } = await supabase
            .from('routine_slots')
            .update(cleanedUpdates)
            .eq('id', slotId)
            .eq('routine_id', routineId);
            
          if (fallbackError) {
            console.error('Fallback update failed:', fallbackError);
            throw fallbackError;
          }
        } else {
          console.error('Error updating routine slot:', error);
          throw error;
        }
      }
      
      // Verify the update was successful by fetching the updated record
      const { data: updatedSlot, error: verifyError } = await supabase
        .from('routine_slots')
        .select('*')
        .eq('id', slotId)
        .eq('routine_id', routineId)
        .single();
        
      if (verifyError) {
        console.warn('Could not verify slot update, but update may have succeeded:', verifyError);
        return;
      }
      
      if (!updatedSlot) {
        throw new Error('Slot update verification failed: Could not find updated slot');
      }
      
      console.log('Slot update successful and verified');
    } catch (innerError) {
      console.error('Error during slot update process:', innerError);
      throw innerError;
    }
  } catch (error) {
    console.error('Error updating routine slot:', error);
    throw error;
  }
}

export async function deleteRoutineSlot(routineId: string, slotId: string): Promise<void> {
  try {
    if (!routineId) {
      throw new Error('Missing routine ID');
    }
    
    if (!slotId) {
      throw new Error('Missing slot ID');
    }
    
    console.log('Service: Deleting routine slot', { routineId, slotId });
    
    // First verify the slot exists and belongs to the routine
    const { data: slot, error: fetchError } = await supabase
      .from('routine_slots')
      .select('id')
      .eq('id', slotId)
      .eq('routine_id', routineId)
      .single();
      
    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        // Not found
        console.warn(`Slot ${slotId} not found in routine ${routineId}, considering deletion successful`);
        return;
      }
      console.error('Error verifying slot before deletion:', fetchError);
      throw fetchError;
    }
    
    if (!slot) {
      console.warn(`Slot ${slotId} not found in routine ${routineId}, considering deletion successful`);
      return;
    }
    
    // Proceed with deletion
    const { error } = await supabase
      .from('routine_slots')
      .delete()
      .eq('id', slotId)
      .eq('routine_id', routineId);

    if (error) {
      console.error('Error deleting routine slot:', error);
      throw error;
    }
    
    // Verify deletion was successful
    const { data: checkSlot, error: checkError } = await supabase
      .from('routine_slots')
      .select('id')
      .eq('id', slotId)
      .eq('routine_id', routineId)
      .single();
      
    if (checkError && checkError.code !== 'PGRST116') {
      // If error isn't "not found", there's a different problem
      console.error('Error verifying slot deletion:', checkError);
      throw checkError;
    }
    
    if (checkSlot) {
      // If we still find the slot, deletion failed
      console.error('Slot deletion verification failed: Slot still exists');
      throw new Error('Failed to delete slot: Record still exists after deletion attempt');
    }
    
    console.log('Slot deleted successfully');
  } catch (error) {
    console.error('Error deleting routine slot:', error);
    throw error;
  }
}

/**
 * Activates a specific routine and deactivates all others
 * @param routineId The ID of the routine to activate
 * @returns Promise that resolves when the routine is activated
 */
export async function activateRoutine(routineId: string): Promise<void> {
  try {
    // First, deactivate all routines
    const { error: deactivateError } = await supabase
      .from('routines')
      .update({ is_active: false })
      .neq('id', routineId);
    
    if (deactivateError) throw deactivateError;
    
    // Then, activate the selected routine
    const { error: activateError } = await supabase
      .from('routines')
      .update({ is_active: true })
      .eq('id', routineId);
    
    if (activateError) throw activateError;
    
  } catch (error) {
    console.error('Error activating routine:', error);
    throw error;
  }
}

/**
 * Deactivates a specific routine without activating others
 * @param routineId The ID of the routine to deactivate
 * @returns Promise that resolves when the routine is deactivated
 */
export async function deactivateRoutine(routineId: string): Promise<void> {
  try {
    const { error } = await supabase
      .from('routines')
      .update({ is_active: false })
      .eq('id', routineId);

    if (error) throw error;
  } catch (error) {
    console.error('Error deactivating routine:', error);
    throw error;
  }
}

/**
 * Converts 12-hour format time (e.g. "09:30 AM") to 24-hour format (e.g. "09:30:00")
 */
function convertTo24HourFormat(timeString: string): string {
  try {
    const [timePart, amPmPart] = timeString.split(' ');
    let [hours, minutes] = timePart.split(':').map(Number);
    
    if (amPmPart.toUpperCase() === 'PM' && hours < 12) {
      hours += 12;
    } else if (amPmPart.toUpperCase() === 'AM' && hours === 12) {
      hours = 0;
    }
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`;
  } catch (error) {
    console.error('Error converting time format:', error);
    return timeString; // Return original if parsing fails
  }
}

/**
 * Bulk import time slots from JSON data
 * @param routineId The ID of the routine to import slots for
 * @param slotsData The array of slot data from the JSON file
 * @returns An object with success count and errors array
 */
export async function bulkImportRoutineSlots(
  routineId: string, 
  slotsData: Array<{
    day: string;
    start_time: string;
    end_time: string;
    course?: string;
    course_title?: string;
    course_code?: string;
    teacher: string;
    room_number?: string;
    section?: string;
    _teacherId?: string; // Optional: directly provided teacher ID
    _courseId?: string;  // Optional: directly provided course ID
  }>
): Promise<{ success: number; errors: any[] }> {
  const errors: any[] = [];
  let successCount = 0;
  
  // Validate routine existence
  try {
    const { data: routine, error: routineError } = await supabase
      .from('routines')
      .select('id')
      .eq('id', routineId)
      .single();
      
    if (routineError || !routine) {
      throw new Error('Routine not found');
    }
  } catch (error: any) {
    return { 
      success: 0, 
      errors: [{ message: `Invalid routine ID: ${error.message}` }] 
    };
  }
  
  // First pass: Extract course/teacher info and fetch their IDs
  const courseCache = new Map<string, string | null>();
  const teacherCache = new Map<string, string | null>();
  
  // Helper function to extract course code
  const extractCourseCode = (courseName: string): string => {
    const parts = courseName.split('-');
    if (parts.length >= 2) {
      return parts[parts.length - 1].trim();
    }
    return courseName.trim();
  };
  
  // Prepare slot data with all necessary validation
  const processedSlots = [];
  
  for (const [index, slot] of slotsData.entries()) {
    try {
      // Use provided IDs if available, otherwise look them up
      let courseId: string | null = slot._courseId || null;
      let teacherId: string | null = slot._teacherId || null;
      
      // Track course and teacher names
      let courseName: string | null = null;
      let teacherName: string | null = null;
      
      // If no explicit course ID provided, try to find it
      if (!courseId) {
        // Handle both new and old formats
        let courseCode = '';
        if (slot.course_code) {
          // New format with explicit code
          courseCode = slot.course_code.trim();
          courseName = slot.course_title || null;
        } else if (slot.course) {
          // Old format "Name - CODE"
          courseCode = extractCourseCode(slot.course);
          courseName = slot.course.split('-')[0].trim() || null;
        }
        
        // Check course cache first or fetch from database if code available
        if (courseCode && courseCode.length > 0) {
          if (courseCache.has(courseCode)) {
            courseId = courseCache.get(courseCode) || null;
          } else {
            const { data: course, error: courseError } = await supabase
              .from('courses')
              .select('id, name')
              .ilike('code', courseCode)
              .limit(1)
              .single();
            
            if (courseError) {
              console.warn(`Course not found: ${courseCode}`, courseError);
            }
            
            if (course) {
              courseId = course.id || null;
              courseName = course.name || courseName;
            }
            courseCache.set(courseCode, courseId);
          }
        }
      } else {
        // If course ID is provided directly, get the course name
        const { data: course } = await supabase
          .from('courses')
          .select('name')
          .eq('id', courseId)
          .single();
        
        if (course) {
          courseName = course.name;
        }
      }
      
      // If no explicit teacher ID provided, try to find it
      if (!teacherId) {
        const teacherNameToSearch = slot.teacher.trim();
        teacherName = teacherNameToSearch;
        
        // Check teacher cache first or fetch from database
        if (teacherCache.has(teacherNameToSearch)) {
          teacherId = teacherCache.get(teacherNameToSearch) || null;
        } else {
          const { data: teacher, error: teacherError } = await supabase
            .from('teachers')
            .select('id')
            .ilike('name', teacherNameToSearch)
            .limit(1)
            .single();
          
          if (teacherError) {
            console.warn(`Teacher not found: ${teacherNameToSearch}`, teacherError);
          }
          
          teacherId = teacher?.id || null;
          teacherCache.set(teacherNameToSearch, teacherId);
        }
      } else {
        // If teacher ID is provided directly, get the teacher name
        const { data: teacher } = await supabase
          .from('teachers')
          .select('name')
          .eq('id', teacherId)
          .single();
        
        if (teacher) {
          teacherName = teacher.name;
        } else {
          teacherName = slot.teacher;
        }
      }
      
      // Validate times and convert to 24-hour format
      const startTime = convertTo24HourFormat(slot.start_time);
      const endTime = convertTo24HourFormat(slot.end_time);
      
      // Check for scheduling conflicts
      const { data: conflicts, error: conflictError } = await supabase
        .from('routine_slots')
        .select('id')
        .eq('routine_id', routineId)
        .eq('day_of_week', slot.day)
        .or(`start_time.lte.${endTime},end_time.gte.${startTime}`)
        .limit(1);
      
      if (conflictError) {
        console.error('Error checking for conflicts:', conflictError);
      }
      
      if (conflicts && conflicts.length > 0) {
        errors.push({
          message: `Slot #${index + 1}: Time conflict with existing slot on ${slot.day} at ${slot.start_time} - ${slot.end_time}`
        });
        continue;
      }
      
      // Prepare the slot data - always include course_name and teacher_name for future compatibility
      processedSlots.push({
        routine_id: routineId,
        course_id: courseId,
        teacher_id: teacherId,
        course_name: courseName,
        teacher_name: teacherName,
        day_of_week: slot.day,
        start_time: startTime,
        end_time: endTime,
        room_number: slot.room_number || null,
        section: slot.section || null
      });
      
    } catch (error: any) {
      errors.push({
        message: `Error processing slot #${index + 1}: ${error.message}`
      });
    }
  }
  
  // Insert all processed slots in a batch
  if (processedSlots.length > 0) {
    try {
      // First try inserting with course_name and teacher_name fields
      try {
        const { data, error } = await supabase
          .from('routine_slots')
          .insert(processedSlots)
          .select();
        
        if (error) {
          // If we get an error about missing columns, try without those columns
          if (error.message.includes('column "course_name" of relation "routine_slots" does not exist') ||
              error.message.includes('column "teacher_name" of relation "routine_slots" does not exist')) {
            throw new Error('Missing columns, using fallback');
          }
          throw error;
        }
        
        successCount = data ? data.length : 0;
      } catch (columnError: any) {
        // Fallback: Try without course_name and teacher_name fields
        console.log('Using fallback for bulk import:', columnError.message);
        
        // Create a new array of slots without the potentially missing columns
        const fallbackSlots = processedSlots.map(slot => {
          const { course_name, teacher_name, ...rest } = slot;
          return rest;
        });
        
        const { data, error } = await supabase
          .from('routine_slots')
          .insert(fallbackSlots)
          .select();
        
        if (error) {
          throw error;
        }
        
        successCount = data ? data.length : 0;
      }
    } catch (error: any) {
      errors.push({
        message: `Database error during import: ${error.message}`
      });
    }
  }
  
  return {
    success: successCount,
    errors
  };
}

/**
 * Export a routine to JSON format including all its slots
 */
export async function exportRoutineWithSlots(routineId: string): Promise<{ routine: any, slots: any[] }> {
  try {
    // Get routine details
    const { data: routine, error: routineError } = await supabase
      .from('routines')
      .select('*')
      .eq('id', routineId)
      .single();
    
    if (routineError) throw routineError;
    if (!routine) throw new Error('Routine not found');
    
    // Get all slots for this routine
    const { data: slots, error: slotsError } = await supabase
      .from('routine_slots')
      .select('*')
      .eq('routine_id', routineId)
      .order('day_of_week', { ascending: true })
      .order('start_time', { ascending: true });
    
    if (slotsError) throw slotsError;
    
    // Return formatted result with both routine and slots
    return {
      routine,
      slots: slots || []
    };
  } catch (error) {
    console.error('Error exporting routine:', error);
    throw error;
  }
}

/**
 * Get a list of all semesters from existing routines
 */
export async function getAllSemesters(): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('routines')
      .select('semester')
      .order('semester', { ascending: true });
    
    if (error) throw error;
    
    // Extract unique semesters
    const semesters = [...new Set(data?.map(r => r.semester) || [])];
    return semesters;
  } catch (error) {
    console.error('Error fetching semesters:', error);
    return [];
  }
}

/**
 * Filters routines by a specific semester
 */
export async function getRoutinesBySemester(semester: string): Promise<any[]> {
  try {
    const { data, error } = await supabase
      .from('routines')
      .select('*')
      .eq('semester', semester)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching routines by semester:', error);
    return [];
  }
}