import { Request, Response } from "express";
import prisma from "../lib/prisma.js";
import openai from "../configs/openai.js";

// Controller Function to Make Revision
export const makeRevision = async (req: Request, res: Response) => {
    const userId = req.userId;

    try {
        const { projectId } = req.params;
        const { message } = req.body;

        if (!userId) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const user = await prisma.user.findUnique({
            where: { id: userId }
        });

        if (!user) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        if (user.credits < 5) {
            return res.status(403).json({ message: "add more credits to make changes" });
        }

        if (!message || message.trim() === "") {
            return res.status(400).json({ message: "Please enter a valid prompt" });
        }

        const currentProject = await prisma.websiteProject.findFirst({
            where: { id: projectId, userId },
            include: { versions: true }
        });

        if (!currentProject) {
            return res.status(404).json({ message: "Project not found" });
        }

        // Save user message
        await prisma.conversation.create({
            data: {
                role: "user",
                content: message,
                projectId
            }
        });

        // ==============================
        // PROMPT ENHANCEMENT
        // ==============================

        const enhanceController = new AbortController();
        const enhanceTimeout = setTimeout(() => enhanceController.abort(), 15000);

        const promptEnhanceResponse = await openai.chat.completions.create(
            {
                model: "z-ai/glm-4.5-air:free",
                messages: [
                    {
                        role: "system",
                        content: `
You are a prompt enhancement specialist. 
Enhance the user's website modification request to be specific and actionable.
Return ONLY the enhanced request in 1-2 sentences.
`
                    },
                    {
                        role: "user",
                        content: `User's request: "${message}"`
                    }
                ]
            },
            { signal: enhanceController.signal }
        );

        clearTimeout(enhanceTimeout);

        const enhancedPrompt =
            promptEnhanceResponse.choices[0]?.message?.content?.trim() || message;

        await prisma.conversation.create({
            data: {
                role: "assistant",
                content: `I've enhanced your prompt to: "${enhancedPrompt}"`,
                projectId
            }
        });

        await prisma.conversation.create({
            data: {
                role: "assistant",
                content: "Now making changes to your website...",
                projectId
            }
        });

        // ==============================
        // CODE GENERATION
        // ==============================

        const codeController = new AbortController();
        const codeTimeout = setTimeout(() => codeController.abort(), 30000);

        const codeGenerationResponse = await openai.chat.completions.create(
            {
                model: "z-ai/glm-4.5-air:free",
                temperature: 0.7,
                messages: [
                    {
                        role: "system",
                        content: `
You are an expert web developer.

CRITICAL REQUIREMENTS:
- Return ONLY the complete updated HTML code.
- Use Tailwind CSS for ALL styling.
- No explanations.
- Standalone HTML document.
`
                    },
                    {
                        role: "user",
                        content: `
Here is the current website code:
${currentProject.current_code.slice(0, 12000)}

User wants this change:
${enhancedPrompt}
`
                    }
                ]
            },
            { signal: codeController.signal }
        );

        clearTimeout(codeTimeout);

        const rawCode =
            codeGenerationResponse.choices[0]?.message?.content || "";

        if (!rawCode) {
            await prisma.conversation.create({
                data: {
                    role: "assistant",
                    content: "Unable to generate the code, please try again",
                    projectId
                }
            });

            return res.status(500).json({ message: "Code generation failed" });
        }

        // Clean markdown formatting
        const cleanedCode = rawCode
            .replace(/```[a-z]*\n?/gi, "")
            .replace(/```$/g, "")
            .trim();

        // ==============================
        // SAVE VERSION
        // ==============================

        const version = await prisma.version.create({
            data: {
                code: cleanedCode,
                description: "changes made",
                projectId
            }
        });

        await prisma.websiteProject.update({
            where: { id: projectId },
            data: {
                current_code: cleanedCode,
                current_version_index: version.id
            }
        });

        // Deduct credits AFTER success
        await prisma.user.update({
            where: { id: userId },
            data: { credits: { decrement: 5 } }
        });

        await prisma.conversation.create({
            data: {
                role: "assistant",
                content:
                    "I've made the changes to your website! You can now preview it.",
                projectId
            }
        });

        return res.json({ message: "Changes made successfully" });

    } catch (error: any) {
        console.log(error?.message || error);
        return res.status(500).json({ message: "Something went wrong" });
    }
};