"""Pydantic models and enums for the data-upload pipeline.

Defines the validated schema that LLM-cleaned records must conform to
(CleanedRequisition) before database insertion, plus a PipelineRecord model
that tracks each record's progress through the parse -> clean -> validate ->
upload stages.

These enums mirror the Prisma schema enums in the Go gateway so that inserted
rows pass database-level CHECK constraints.
"""

from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum


class RequisitionCategory(str, Enum):
    ENGINEERING_CONTRACTORS = "ENGINEERING_CONTRACTORS"
    CONTENT_TRUST_SAFETY = "CONTENT_TRUST_SAFETY"
    DATA_OPERATIONS = "DATA_OPERATIONS"
    MARKETING_CREATIVE = "MARKETING_CREATIVE"
    CORPORATE_SERVICES = "CORPORATE_SERVICES"


class RequisitionStatus(str, Enum):
    OPEN = "OPEN"
    SOURCING = "SOURCING"
    INTERVIEWING = "INTERVIEWING"
    OFFER = "OFFER"
    ONBOARDING = "ONBOARDING"
    ACTIVE = "ACTIVE"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


class Priority(str, Enum):
    CRITICAL = "CRITICAL"
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


class CleanedRequisition(BaseModel):
    """Validated output from the cleaner agent. Must match DB schema exactly."""

    roleTitle: str = Field(min_length=1)
    category: RequisitionCategory
    team: str = "Unassigned"
    department: str = "General"
    headcountNeeded: int = Field(ge=1, default=1)
    vendor: str = "TBD"
    billRateHourly: float = Field(ge=0)
    location: str = "Remote"
    status: RequisitionStatus = RequisitionStatus.OPEN
    priority: Priority = Priority.MEDIUM
    budgetAllocated: Optional[float] = None
    startDate: Optional[str] = None
    endDate: Optional[str] = None
    notes: Optional[str] = None


class RecordStatus(str, Enum):
    PENDING = "PENDING"
    PARSING = "PARSING"
    CLEANING = "CLEANING"
    VALIDATED = "VALIDATED"
    UPLOADED = "UPLOADED"
    FAILED = "FAILED"


class PipelineRecord(BaseModel):
    """Tracks a single record through the pipeline."""

    index: int
    raw_data: dict
    cleaned_data: Optional[dict] = None
    validated: bool = False
    status: RecordStatus = RecordStatus.PENDING
    error: Optional[str] = None
    requisition_id: Optional[str] = None
