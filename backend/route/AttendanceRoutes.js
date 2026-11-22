import express from "express";
import {
  getAttendanceSettings, updateAttendanceSettings, getDayAttendance, saveAttendance, getMonthAttendance, getStaffMonth, getStaffList,
} from "../controllers/AttendanceController.js";

const router = express.Router();

// Staff attendance (F15)
router.get("/attendance/settings", getAttendanceSettings);
router.put("/attendance/settings", updateAttendanceSettings);
router.get("/attendance/day", getDayAttendance);
router.post("/attendance/save", saveAttendance);
router.get("/attendance/month", getMonthAttendance);
router.get("/attendance/staff-list", getStaffList);
router.get("/attendance/staff/:staffId", getStaffMonth);

export default router;
